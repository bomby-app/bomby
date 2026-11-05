"""Memory across calls, in the user's own Zep project (docs/decisions/memory-across-calls-with-zep.md).

What Bomby knows is read once, before the call, into the voice prompt; mid-call it comes
through `recall_about_user`; and what the user says is written in the background. A call
without a `memory_user`, or a worker without `ZEP_API_KEY`, has none of it. Never raises:
a Zep failure leaves the call working without memory.

zep-cloud 4.0.1: users and threads are addressed by Zep's own UUIDs, so the install's user
is looked up by its id (or made once), and each call gets a new thread.
"""

import asyncio
import logging
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from livekit.agents import (
    AgentSession,
    ConversationItemAddedEvent,
    UserInputTranscribedEvent,
    llm,
)
from zep_cloud import (
    AddMessage,
    AsyncZep,
    DateFilter,
    DateFilterGroup,
    DateFilters,
    Edge,
    EdgeSearchFilters,
    NotFoundError,
)

logger = logging.getLogger("bomby.memory")

# A stable description of the durable profile: at a call's start there's nothing else to
# search with.
PROFILE_QUERY = "who the user is, their name, their projects, how they like to work"
# Until Zep has a summary, the first facts tend to describe the talk, not the person, and
# greeting a stranger as someone remembered is worse than not remembering.
MIN_FACTS_WITHOUT_SUMMARY = 4
FACT_LIMIT = 20
RECALL_LIMIT = 6
# Only facts still true: a corrected one stays in the graph but isn't recalled.
CURRENT = EdgeSearchFilters(
    date_filters=DateFilters(
        any_of=[
            DateFilterGroup(all_of=[DateFilter(field="invalid_at", operator="is_null")])
        ]
    )
)


def _fact(edge: Edge) -> str:
    return f"- {edge.fact} ({edge.valid_at or 'date unknown'} to {edge.invalid_at or 'now'})"


class Memory:
    """One call's memory: the install's Zep user, and this call's thread."""

    def __init__(
        self, client: AsyncZep, user_id: str, user_uuid: str, thread_uuid: str | None
    ):
        self._client: AsyncZep = client
        self._user_id: str = user_id
        self._user_uuid: str = user_uuid
        # None when the call saves nothing (incognito).
        self._thread_uuid: str | None = thread_uuid
        self._writes: set[asyncio.Task[None]] = set()
        # The last thing the user said that Gemini hadn't finalised yet.
        self._unfinished: tuple[str, str | None] | None = None

    @classmethod
    async def open(
        cls, user_id: str, environ: Mapping[str, str], saves: bool = True
    ) -> "Memory | None":
        """The call's memory, or None when it has none or Zep can't be reached. One that
        saves nothing opens no thread, so nothing can be written."""
        key = environ.get("ZEP_API_KEY", "").strip()
        if not user_id or not key:
            return None
        client = AsyncZep(api_key=key)
        try:
            try:
                user = await client.user.lookup(user_id=user_id)
            except NotFoundError:
                user = await client.user.create(user_id=user_id)
            if not user.uuid_:
                return None
            thread_uuid = None
            if saves:
                thread = await client.thread.create(user_uuid=user.uuid_)
                if not thread.uuid_:
                    return None
                thread_uuid = thread.uuid_
        except Exception:
            logger.exception("zep unavailable, this call has no memory")
            return None
        logger.info("memory on for %s%s", user_id, "" if saves else ", saving nothing")
        return cls(client, user_id, user.uuid_, thread_uuid)

    async def remembered(self) -> str:
        """What Bomby knows about the user before it speaks, or "" for a stranger."""
        summary, facts = await asyncio.gather(
            self._summary(), self._facts(PROFILE_QUERY, FACT_LIMIT)
        )
        if not summary and len(facts) < MIN_FACTS_WITHOUT_SUMMARY:
            logger.info("not enough remembered yet (%d facts, no summary)", len(facts))
            return ""
        parts = [summary] if summary else []
        if facts:
            parts.append("\n".join(_fact(edge) for edge in facts))
        logger.info("remembered %d facts, summary %d chars", len(facts), len(summary))
        return "\n\n".join(parts)

    async def recall(self, query: str) -> str:
        """One question about the user's past, answered from the graph."""
        facts = await self._facts(query, RECALL_LIMIT)
        if not facts:
            return "Nothing remembered about that. Ask the user."
        return "\n".join(_fact(edge) for edge in facts)

    async def _summary(self) -> str:
        try:
            node = await self._client.user.get_node(self._user_uuid)
        except Exception:
            logger.debug("no user summary yet", exc_info=True)
            return ""
        summary = (node.summary or "").strip()
        # A new user's summary is a stub built from its id: content-shaped, but empty.
        return "" if self._user_id in summary else summary

    async def _facts(self, query: str, limit: int) -> list[Edge]:
        try:
            page = await self._client.graph.search_edges(
                self._user_uuid,
                query=query,
                page_size=limit,
                reranker="cross_encoder",
                filters=CURRENT,
            )
        except Exception:
            logger.debug("no facts for %r", query, exc_info=True)
            return []
        return [edge for edge in page.items or [] if edge.fact]

    async def _write(self, said: str, before: str | None) -> None:
        """One exchange: the user's words, with Bomby's line before them for context."""
        if self._thread_uuid is None:
            return
        messages: list[AddMessage] = []
        if before:
            messages.append(AddMessage(content=before, role="assistant", name="Bomby"))
        messages.append(
            AddMessage(
                content=said, role="user", reference_time=datetime.now(UTC).isoformat()
            )
        )
        try:
            # Bomby's own lines give context but aren't facts about the user.
            _ = await self._client.thread.add_messages(
                self._thread_uuid, messages=messages, ignore_roles=["assistant"]
            )
        except Exception:
            logger.exception("couldn't write to memory")

    def _write_soon(self, said: str, before: str | None) -> None:
        task = asyncio.create_task(self._write(said, before))
        self._writes.add(task)
        task.add_done_callback(self._writes.discard)

    def attach(self, session: AgentSession[Any]) -> None:
        """Records what the user says as the call goes, without making them wait.

        Hangs off `user_input_transcribed`: Gemini detects turns on its server, so
        `on_user_turn_completed` never fires. Nothing to do when the call saves nothing.
        """
        if self._thread_uuid is None:
            return
        state: dict[str, str | None] = {"last": None, "before": None}

        def on_item(event: ConversationItemAddedEvent) -> None:
            item = event.item
            if isinstance(item, llm.ChatMessage) and item.role == "assistant":
                state["last"] = item.text_content or state["last"]

        def on_transcript(event: UserInputTranscribedEvent) -> None:
            text = event.transcript.strip()
            if not event.is_final:
                # An empty interim marks the start of the user's turn.
                if not text:
                    state["before"] = state["last"]
                else:
                    self._unfinished = (text, state["before"] or state["last"])
                return
            self._unfinished = None
            if text:
                self._write_soon(text, state["before"] or state["last"])

        # LiveKit's emitter is untyped; the ignores are its.
        _ = session.on("conversation_item_added", on_item)  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
        _ = session.on("user_input_transcribed", on_transcript)  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]

    async def aclose(self) -> None:
        """Writes what the user said last, if Gemini never finalised it, then waits."""
        if self._unfinished:
            await self._write(*self._unfinished)
            self._unfinished = None
        if self._writes:
            _ = await asyncio.gather(*self._writes, return_exceptions=True)
