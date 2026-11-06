"""Memory across calls, in the user's own Zep project (docs/decisions/memory-across-calls-with-zep.md).

What Bomby knows is read once, before Gemini connects, into the voice prompt; mid-call it
comes through `recall_about_user`; and the conversation is saved to a Zep thread as it
goes. A call without a `memory_user`, or a worker without `ZEP_API_KEY`, has none of it.
Zep failing never fails the call: a call that can't reach it at the start has no memory,
and the app shows the user a card (the `bomby.memory` attribute).

zep-cloud 4.0.1 addresses users and threads by Zep's own UUIDs, so the install's user is
looked up by its id (or made once), and a call gets a new thread when it has something to
save. Facts: docs/zep-notes.md.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from livekit import rtc
from livekit.agents import (
    CloseEvent,
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
    User,
)
from zep_cloud.core.request_options import RequestOptions

from call_options import CallOptions

logger = logging.getLogger("bomby.memory")

# What the agent sets on its participant when this call has no memory (app: call-view.tsx).
ATTRIBUTE = "bomby.memory"
UNAVAILABLE = "unavailable"
ASSISTANT_NAME = "Bomby"

# Seconds. Zep answers in well under one; a slow connection gets the rest. Each request
# gets the same, without retries, so one slow request can't outlast the budget.
START_BUDGET = 5.0
RECALL_BUDGET = 5.0
# Inside LiveKit's 10 s job shutdown (`shutdown_process_timeout`).
CLOSE_BUDGET = 8.0
# How long hanging up waits for the session to close, so its last lines are in.
CLOSE_WAIT = 3.0
SAVE_RETRY_DELAY = 1.0
NO_RETRIES: RequestOptions = {"max_retries": 0}

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
# Zep's limits for `thread.add_messages` (help.getzep.com/adding-messages).
MAX_MESSAGES = 30
MAX_CHARS = 4096
# Bomby cut off this early ("...and") says nothing worth keeping.
MIN_INTERRUPTED_WORDS = 3

Role = Literal["user", "assistant"]
# An interim transcript without LiveKit's item id: its final line replaces it all the same.
UNKNOWN_ITEM = "unknown"


class MemoryUnavailable(Exception):
    """Zep couldn't be reached at the start of the call."""


@dataclass(frozen=True)
class Line:
    """One line of the conversation, as Zep gets it. `at` is when it was said (epoch s)."""

    id: str
    role: Role
    text: str
    at: float


def _fact(edge: Edge) -> str:
    return f"- {edge.fact} ({edge.valid_at or 'date unknown'} to {edge.invalid_at or 'now'})"


def _rfc3339(at: float) -> str:
    return datetime.fromtimestamp(at, UTC).isoformat()


class Memory:
    """One call's memory: the install's Zep user, and the thread this call saves to."""

    def __init__(
        self,
        client: AsyncZep,
        user_uuid: str,
        user_name: str = "",
        saves: bool = True,
    ) -> None:
        self._client: AsyncZep = client
        self._user_uuid: str = user_uuid
        # Zep maps a message to the user node by its name (help.getzep.com/adding-messages).
        self._user_name: str = user_name
        # False on an incognito call: nothing is ever written.
        self._saves: bool = saves
        self._on_unavailable: Callable[[], Awaitable[None]] | None = None
        self._flagged: bool = False

        # Made on the first save, so a call where the user says nothing leaves no thread.
        self._thread_uuid: str | None = None
        self._seen: set[str] = set()
        # Lines not sent yet. Bomby's wait for the user's next one: Gemini sends the
        # user's final transcript only after its reply, which then must not go first.
        self._pending: list[Line] = []
        # What the user is saying that Gemini hasn't finalised yet, saved on hang-up.
        self._unfinished: Line | None = None
        # One writer, so batches reach Zep one at a time, in order.
        self._queue: asyncio.Queue[list[Line] | None] = asyncio.Queue()
        self._writer: asyncio.Task[None] | None = None
        self._background: set[asyncio.Task[None]] = set()
        self._session_closed: asyncio.Event = asyncio.Event()

    @classmethod
    async def open(
        cls, options: CallOptions, zone: str, environ: Mapping[str, str]
    ) -> tuple["Memory | None", str]:
        """The call's memory and what it remembers for the voice prompt, or `(None, "")`
        when the call has none. Raises `MemoryUnavailable` when Zep can't be reached in
        `START_BUDGET`. An incognito call never creates anything, not even the user."""
        user_id = options.memory_user
        key = environ.get("ZEP_API_KEY", "").strip()
        if not user_id or not key:
            return None, ""
        saves = not options.memory_incognito
        client = AsyncZep(api_key=key, timeout=START_BUDGET)
        try:
            async with asyncio.timeout(START_BUDGET):
                user = await _find_user(client, user_id, options.user_name, zone, saves)
                if user is None:
                    logger.info("incognito, and nothing remembered yet")
                    return None, ""
                if not user.uuid_:
                    raise RuntimeError("zep gave the user no uuid")
                memory = cls(client, user.uuid_, options.user_name, saves)
                remembered = await memory.remembered()
        except Exception as e:
            logger.warning("zep unavailable, this call has no memory: %r", e)
            raise MemoryUnavailable from e
        if saves:
            memory._sync_profile(user, options.user_name, zone)
        logger.info("memory on for %s%s", user_id, "" if saves else ", saving nothing")
        return memory, remembered

    def on_unavailable(self, callback: Callable[[], Awaitable[None]]) -> None:
        """Told once when Zep stops answering mid-call, so the app can show it. Must not
        raise."""
        self._on_unavailable = callback

    # Reading

    async def remembered(self) -> str:
        """What Bomby knows about the user before it speaks, or "" for a stranger."""
        summary, facts = await asyncio.gather(
            self._summary(), self._facts(PROFILE_QUERY, FACT_LIMIT)
        )
        # A new user's summary is a stub Zep writes from their id and name, before any
        # facts; a real one comes from facts.
        if not facts:
            summary = ""
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
        try:
            async with asyncio.timeout(RECALL_BUDGET):
                facts = await self._facts(query, RECALL_LIMIT)
        except Exception:
            logger.exception("couldn't recall %r", query)
            await self._unavailable()
            return "You can't remember that right now."
        if not facts:
            return "Nothing remembered about that. Ask the user."
        return "\n".join(_fact(edge) for edge in facts)

    async def _summary(self) -> str:
        try:
            node = await self._client.user.get_node(
                self._user_uuid, request_options=NO_RETRIES
            )
        except NotFoundError:
            return ""
        return (node.summary or "").strip()

    async def _facts(self, query: str, limit: int) -> list[Edge]:
        page = await self._client.graph.search_edges(
            self._user_uuid,
            query=query,
            page_size=limit,
            reranker="cross_encoder",
            filters=CURRENT,
            request_options=NO_RETRIES,
        )
        return [edge for edge in page.items or [] if edge.fact]

    # Saving

    def attach(self, session: rtc.EventEmitter[Any]) -> None:
        """Saves the conversation as it goes, without making anyone wait: every line,
        spoken or typed, from `conversation_item_added`, in the order it was said.
        Nothing to do on a call that saves nothing."""
        if not self._saves:
            return
        # LiveKit's emitter is untyped; the ignores are its.
        _ = session.on("conversation_item_added", self._on_item)  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
        _ = session.on("user_input_transcribed", self._on_transcript)  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
        _ = session.on("close", self._on_close)  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]

    def _on_item(self, event: ConversationItemAddedEvent) -> None:
        item = event.item
        if not isinstance(item, llm.ChatMessage) or item.id in self._seen:
            return
        if item.role != "user" and item.role != "assistant":
            return
        text = (item.text_content or "").strip()
        if not text:
            return
        if (
            item.role == "assistant"
            and item.interrupted
            and len(text.split()) < MIN_INTERRUPTED_WORDS
        ):
            return
        self._seen.add(item.id)
        self._pending.append(Line(item.id, item.role, text, item.created_at))
        if item.role == "user":
            if self._unfinished and self._unfinished.id in (item.id, UNKNOWN_ITEM):
                self._unfinished = None
            self._flush()

    def _on_transcript(self, event: UserInputTranscribedEvent) -> None:
        text = event.transcript.strip()
        # The final one arrives as a conversation item; an empty one marks speech stopping.
        if event.is_final or not text:
            return
        item_id = event.item_id or UNKNOWN_ITEM
        if item_id in self._seen:
            return
        started = (
            self._unfinished.at
            if self._unfinished and self._unfinished.id == item_id
            else event.created_at
        )
        self._unfinished = Line(item_id, "user", text, started)

    def _on_close(self, _: CloseEvent) -> None:
        self._session_closed.set()

    def _flush(self, last: bool = False) -> None:
        """Sends what's pending, in the order it was said. Bomby's lines alone wait for
        the user's next one, unless this is the end of the call; and until the user has
        said something, nothing is sent at all."""
        lines = sorted(self._pending, key=lambda line: line.at)
        self._pending = []
        if not lines:
            return
        if self._thread_uuid is None and self._writer is None:
            if not any(line.role == "user" for line in lines):
                if not last:
                    self._pending = lines
                return
            self._writer = asyncio.create_task(self._write_all())
        self._queue.put_nowait(lines)

    async def _write_all(self) -> None:
        while (lines := await self._queue.get()) is not None:
            await self._write(lines)

    async def _write(self, lines: list[Line]) -> None:
        """One batch, in Zep-sized chunks; a chunk that fails is tried once more, and the
        retry resends only what didn't land."""
        chunks = [
            lines[i : i + MAX_MESSAGES] for i in range(0, len(lines), MAX_MESSAGES)
        ]
        for attempt in range(2):
            try:
                if self._thread_uuid is None:
                    thread = await self._client.thread.create(user_uuid=self._user_uuid)
                    if not thread.uuid_:
                        raise RuntimeError("zep made a thread without a uuid")
                    self._thread_uuid = thread.uuid_
                    logger.info("saving this call to zep thread %s", thread.uuid_)
                while chunks:
                    # Bomby's own lines give context but aren't facts about the user.
                    _ = await self._client.thread.add_messages(
                        self._thread_uuid,
                        messages=[self._message(line) for line in chunks[0]],
                        ignore_roles=["assistant"],
                    )
                    _ = chunks.pop(0)
                return
            except Exception as e:
                if attempt == 0:
                    logger.warning("couldn't save to memory, trying again: %r", e)
                    await asyncio.sleep(SAVE_RETRY_DELAY)
                else:
                    lost = sum(len(chunk) for chunk in chunks)
                    logger.exception("couldn't save %d lines to memory", lost)
                    await self._unavailable()

    def _message(self, line: Line) -> AddMessage:
        name = ASSISTANT_NAME if line.role == "assistant" else self._user_name or None
        return AddMessage(
            content=line.text[:MAX_CHARS],
            role=line.role,
            name=name,
            reference_time=_rfc3339(line.at),
        )

    def _sync_profile(self, user: User, name: str, zone: str) -> None:
        """Keeps the Zep user's name and time zone as Settings and the Mac have them, in
        the background. An empty name stays empty."""
        if (user.first_name or "") == name and (not zone or user.time_zone == zone):
            return

        async def update() -> None:
            try:
                _ = await self._client.user.update(
                    self._user_uuid, first_name=name, time_zone=zone or user.time_zone
                )
            except Exception:
                logger.exception("couldn't update the zep user")

        task = asyncio.create_task(update())
        self._background.add(task)
        task.add_done_callback(self._background.discard)

    async def _unavailable(self) -> None:
        if self._flagged or self._on_unavailable is None:
            return
        self._flagged = True
        await self._on_unavailable()

    async def aclose(self) -> None:
        """Saves the rest of the call on hang-up: waits for the session to close (it
        closes alongside this), then sends what's left, the user's unfinished line too.
        Never raises, and gives up after `CLOSE_BUDGET`."""
        try:
            async with asyncio.timeout(CLOSE_BUDGET):
                if self._saves:
                    try:
                        async with asyncio.timeout(CLOSE_WAIT):
                            _ = await self._session_closed.wait()
                    except TimeoutError:
                        logger.debug("the session didn't close, saving what's in")
                    if self._unfinished:
                        self._pending.append(self._unfinished)
                        self._unfinished = None
                    self._flush(last=True)
                    if self._writer:
                        self._queue.put_nowait(None)
                        await self._writer
                if self._background:
                    _ = await asyncio.gather(*self._background, return_exceptions=True)
        except TimeoutError:
            logger.warning("gave up saving the end of the call to memory")
        except Exception:
            logger.exception("couldn't save the end of the call to memory")


async def _find_user(
    client: AsyncZep, user_id: str, name: str, zone: str, saves: bool
) -> User | None:
    """The install's Zep user, made with the user's name and time zone the first time.
    None on an incognito call when there's none yet."""
    try:
        return await client.user.lookup(user_id=user_id, request_options=NO_RETRIES)
    except NotFoundError:
        if not saves:
            return None
    return await client.user.create(
        user_id=user_id,
        first_name=name or None,
        time_zone=zone or None,
        request_options=NO_RETRIES,
    )
