import asyncio
import json
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace
from typing import Any, final

import pytest
from livekit import rtc
from livekit.agents import (
    CloseEvent,
    ConversationItemAddedEvent,
    UserInputTranscribedEvent,
    llm,
)
from livekit.agents.voice.events import CloseReason
from zep_cloud import ApiError, NotFoundError

import memory as memory_module
from call_options import CallOptions
from harnesses import HARNESSES
from job import read_metadata
from memory import Memory, MemoryUnavailable
from project import Project
from voice_prompt import PROMPTS, voice_instructions

AGENTS = [HARNESSES["claude"]]
ZONE = "Region/Some_City"
ENV = {"ZEP_API_KEY": "key"}


@final
class FakeZep:
    """Zep's client as Memory uses it, recording each request."""

    def __init__(
        self,
        known: bool = True,
        first_name: str = "",
        summary: str = "",
        facts: tuple[str, ...] = (),
        failing_adds: int = 0,
        lost_replies: int = 0,
        slow: bool = False,
    ) -> None:
        self.requests: list[tuple[str, dict[str, Any]]] = []
        self.saved: list[tuple[str, str | None, str]] = []
        self._known, self._first_name = known, first_name
        self._summary, self._facts = summary, facts
        self._failing_adds, self._slow = failing_adds, slow
        # Saved, but the reply never arrives: the client sees an error.
        self._lost_replies = lost_replies
        self._keys: set[str] = set()
        self.user = SimpleNamespace(
            lookup=self._lookup, create=self._create, update=self._update,
            get_node=self._get_node,
        )  # fmt: skip
        self.thread = SimpleNamespace(create=self._thread, add_messages=self._add)
        self.graph = SimpleNamespace(search_edges=self._search)

    async def _request(self, name: str, **fields: Any) -> None:
        self.requests.append((name, fields))
        if self._slow:
            await asyncio.sleep(60)

    def names(self) -> list[str]:
        return [name for name, _ in self.requests]

    async def _lookup(self, **fields: Any) -> object:
        await self._request("user.lookup", **fields)
        if not self._known:
            raise NotFoundError(body=ApiError())
        return SimpleNamespace(
            uuid_="user-uuid", first_name=self._first_name, time_zone=ZONE
        )

    async def _create(self, **fields: Any) -> object:
        await self._request("user.create", **fields)
        return SimpleNamespace(uuid_="user-uuid", first_name=None, time_zone=None)

    async def _update(self, uuid: str, **fields: Any) -> None:
        await self._request("user.update", uuid=uuid, **fields)

    async def _get_node(self, uuid: str, **_: Any) -> object:
        await self._request("user.get_node", uuid=uuid)
        return SimpleNamespace(summary=self._summary)

    async def _search(self, uuid: str, **fields: Any) -> object:
        await self._request("graph.search_edges", uuid=uuid, query=fields["query"])
        edges = [
            SimpleNamespace(fact=f, valid_at="2026-11-01", invalid_at=None)
            for f in self._facts
        ]
        return SimpleNamespace(items=edges)

    async def _thread(self, **fields: Any) -> object:
        await self._request("thread.create", **fields)
        return SimpleNamespace(uuid_="thread-uuid")

    async def _add(self, thread: str, messages: list[Any], **fields: Any) -> None:
        await self._request("thread.add_messages", thread=thread, **fields)
        if self._failing_adds:
            self._failing_adds -= 1
            raise ConnectionError("zep is down")
        # Lets a later batch try to overtake this one, as a slow request would.
        await asyncio.sleep(0.01)
        # Zep's idempotency: a key it has seen saves nothing again.
        key = fields["idempotency_key"]
        if key not in self._keys:
            self._keys.add(key)
            self.saved += [(m.role, m.name, m.content) for m in messages]
        if self._lost_replies:
            self._lost_replies -= 1
            raise ConnectionError("the reply got lost")


def client(zep: FakeZep) -> Callable[..., FakeZep]:
    """Stands in for `AsyncZep`."""

    def make(**_: object) -> FakeZep:
        return zep

    return make


def opened(
    zep: FakeZep, monkeypatch: pytest.MonkeyPatch, **options: Any
) -> tuple[Memory | None, str]:
    monkeypatch.setattr(memory_module, "AsyncZep", client(zep))
    call = CallOptions(voice="Leda", memory_user="bomby-1", **options)
    return asyncio.run(Memory.open(call, ZONE, ENV))


def said(
    role: str, text: str, at: float, id: str, interrupted: bool = False
) -> ConversationItemAddedEvent:
    item = llm.ChatMessage(role=role, content=[text], id=id, interrupted=interrupted)  # pyright: ignore[reportArgumentType]
    item.created_at = at
    return ConversationItemAddedEvent(item=item)


def call_with(
    zep: FakeZep, user_name: str = "Sam"
) -> tuple[Memory, rtc.EventEmitter[Any]]:
    memory = Memory(zep, "user-uuid", user_name)  # pyright: ignore[reportArgumentType]
    session: rtc.EventEmitter[Any] = rtc.EventEmitter()
    memory.attach(session)
    return memory, session


async def hang_up(memory: Memory, session: rtc.EventEmitter[Any]) -> None:
    closing = asyncio.create_task(memory.aclose())
    await asyncio.sleep(0)
    session.emit("close", CloseEvent(reason=CloseReason.USER_INITIATED))
    await closing


# Reading


@pytest.mark.parametrize(
    ("user_id", "environ"),
    [("", {"ZEP_API_KEY": "key"}), ("bomby-1", {}), ("bomby-1", {"ZEP_API_KEY": " "})],
)
def test_memory_is_off_without_a_user_or_a_key(
    user_id: str, environ: dict[str, str]
) -> None:
    options = CallOptions(voice="Leda", memory_user=user_id)
    assert asyncio.run(Memory.open(options, ZONE, environ)) == (None, "")


def test_the_memory_user_comes_from_the_app_or_the_console() -> None:
    fields = read_metadata(
        json.dumps({"memory_user": " bomby-0123 ", "memory_incognito": True})
    )
    options = CallOptions.from_job(fields, {})
    assert options.memory_user == "bomby-0123"
    assert options.memory_incognito
    assert CallOptions.from_job(read_metadata("{}"), {}).memory_user == ""
    console = CallOptions.from_job(None, {"BOMBY_MEMORY_USER": "bomby-console"})
    assert console.memory_user == "bomby-console"


def test_a_new_user_is_made_with_the_name_and_time_zone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    zep = FakeZep(known=False)
    memory, remembered = opened(zep, monkeypatch, user_name="Sam")
    assert memory is not None and remembered == ""
    create = dict(zep.requests)["user.create"]
    assert create["user_id"] == "bomby-1"
    assert (create["first_name"], create["time_zone"]) == ("Sam", ZONE)


def test_a_user_without_a_name_stays_without_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    zep = FakeZep(known=False)
    _ = opened(zep, monkeypatch)
    assert dict(zep.requests)["user.create"]["first_name"] is None


def test_a_changed_name_reaches_zep(monkeypatch: pytest.MonkeyPatch) -> None:
    zep = FakeZep(first_name="Sam")
    monkeypatch.setattr(memory_module, "AsyncZep", client(zep))

    async def scenario() -> None:
        options = CallOptions(voice="Leda", memory_user="bomby-1", user_name="Sammy")
        memory, _ = await Memory.open(options, ZONE, ENV)
        assert memory is not None
        await memory.aclose()

    asyncio.run(scenario())
    assert dict(zep.requests)["user.update"]["first_name"] == "Sammy"


def test_an_incognito_call_creates_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    zep = FakeZep(known=False)
    assert opened(zep, monkeypatch, memory_incognito=True) == (None, "")
    assert zep.names() == ["user.lookup"]


def test_an_incognito_call_reads_but_never_writes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    zep = FakeZep(first_name="Sam", facts=("Sam ships on Fridays",) * 4)
    monkeypatch.setattr(memory_module, "AsyncZep", client(zep))

    async def scenario() -> None:
        options = CallOptions(
            voice="Leda",
            memory_user="bomby-1",
            user_name="Sammy",
            memory_incognito=True,
        )
        memory, remembered = await Memory.open(options, ZONE, ENV)
        assert memory is not None and "Sam ships on Fridays" in remembered
        session: rtc.EventEmitter[Any] = rtc.EventEmitter()
        memory.attach(session)
        session.emit(
            "conversation_item_added", said("user", "my son loves strawberry", 1, "u1")
        )
        await hang_up(memory, session)

    asyncio.run(scenario())
    assert set(zep.names()) == {"user.lookup", "user.get_node", "graph.search_edges"}


def test_zep_that_cant_answer_in_time_leaves_the_call_without_memory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(memory_module, "START_BUDGET", 0.05)
    with pytest.raises(MemoryUnavailable):
        _ = opened(FakeZep(slow=True), monkeypatch)


def test_a_summary_counts_once_there_are_facts(monkeypatch: pytest.MonkeyPatch) -> None:
    # Zep's real summaries quote the user's id too (help.getzep.com/user-summary).
    summary = "Sam is a user with account ID bomby-1 who builds a music app."
    assert opened(FakeZep(summary=summary), monkeypatch)[1] == ""
    _, remembered = opened(
        FakeZep(summary=summary, facts=("Sam ships on Fridays",)), monkeypatch
    )
    assert remembered.startswith(summary)
    assert "- Sam ships on Fridays (2026-11-01 to now)" in remembered


def test_what_is_remembered_follows_the_user_section() -> None:
    project = Project(name="samba", folders=(Path.home(),))
    options = CallOptions(voice="Leda", user_name="Sam")
    plain = voice_instructions(project, options, AGENTS)
    remembered = voice_instructions(
        project, options, AGENTS, "- Sam ships on Fridays (2026-11-01 to now)"
    )

    assert "## What you remember" not in plain
    assert remembered.startswith(PROMPTS["gemini", "sharp"])
    assert remembered.index("## The user") < remembered.index("## What you remember")
    assert "Sam ships on Fridays" in remembered


def test_only_a_call_with_memory_can_recall() -> None:
    from acp_client import CallRunners
    from agent import Assistant
    from job import JobMetadata

    runners = CallRunners.for_job(JobMetadata(folders=(Path.home(),)))
    options = CallOptions(voice="Leda")

    def names(assistant: Assistant) -> list[str]:
        return [getattr(tool, "id", "") for tool in assistant.tools]

    assert "recall_about_user" not in names(Assistant(options, runners))
    assert "recall_about_user" in names(Assistant(options, runners, remembers=True))
    # Gemini calls search the web with Google's own search unless the user turned it off.
    assert "gemini_google_search" in names(Assistant(options, runners))
    off = CallOptions(voice="Leda", provider_options={"google_search": False})
    assert "gemini_google_search" not in names(Assistant(off, runners))


def test_recall_that_cant_reach_zep_says_so_and_tells_the_app(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(memory_module, "RECALL_BUDGET", 0.05)
    flagged: list[bool] = []

    async def scenario() -> str:
        memory = Memory(FakeZep(slow=True), "user-uuid")  # pyright: ignore[reportArgumentType]

        async def unavailable() -> None:
            flagged.append(True)

        memory.on_unavailable(unavailable)
        answer = await memory.recall("their son")
        await asyncio.sleep(0)
        return answer

    assert asyncio.run(scenario()) == "You can't remember that right now."
    assert flagged == [True]


# Saving, with the events in the order LiveKit 1.8.10 sends them for Gemini Live


def test_a_call_is_saved_in_the_order_it_was_said() -> None:
    zep = FakeZep()

    async def scenario() -> None:
        memory, session = call_with(zep)
        session.emit(
            "conversation_item_added", said("assistant", "Hi Sam, what's up?", 1, "a0")
        )
        # Gemini finalises the user's line after its reply is ready, but LiveKit stamps it
        # with when the turn started, so it can land after the reply it prompted.
        session.emit(
            "conversation_item_added",
            said("assistant", "Sure, Claude's on it.", 5, "a1"),
        )
        session.emit(
            "conversation_item_added", said("user", "Fix the login page", 3, "u1")
        )
        session.emit("conversation_item_added", said("user", "Thanks", 7, "u2"))
        await hang_up(memory, session)

    asyncio.run(scenario())
    assert zep.saved == [
        ("assistant", "Bomby", "Hi Sam, what's up?"),
        ("user", "Sam", "Fix the login page"),
        ("assistant", "Bomby", "Sure, Claude's on it."),
        ("user", "Sam", "Thanks"),
    ]
    assert zep.names().count("thread.create") == 1


def test_bombys_reply_waits_for_the_line_it_answers() -> None:
    zep = FakeZep()

    async def scenario() -> None:
        memory, session = call_with(zep)
        session.emit("conversation_item_added", said("user", "Hello", 1, "u1"))
        session.emit("conversation_item_added", said("assistant", "Hi.", 2, "a1"))
        session.emit(
            "conversation_item_added", said("assistant", "Claude's done.", 6, "a2")
        )
        await asyncio.sleep(0.05)
        assert zep.saved == [("user", "Sam", "Hello")]
        await hang_up(memory, session)

    asyncio.run(scenario())
    assert [text for _, _, text in zep.saved] == ["Hello", "Hi.", "Claude's done."]


def test_typed_lines_are_saved_like_spoken_ones() -> None:
    zep = FakeZep()

    async def scenario() -> None:
        memory, session = call_with(zep)
        # A typed line has no transcript events, only the conversation item.
        session.emit(
            "conversation_item_added", said("user", "use the staging db", 1, "t1")
        )
        await hang_up(memory, session)

    asyncio.run(scenario())
    assert zep.saved == [("user", "Sam", "use the staging db")]


def test_bomby_cut_off_after_a_word_or_two_is_left_out() -> None:
    zep = FakeZep()

    async def scenario() -> None:
        memory, session = call_with(zep)
        session.emit(
            "conversation_item_added",
            said("assistant", "...and", 1, "a1", interrupted=True),
        )
        session.emit(
            "conversation_item_added",
            said(
                "assistant", "Claude changed two files and", 2, "a2", interrupted=True
            ),
        )
        session.emit("conversation_item_added", said("user", "and", 3, "u1"))
        await hang_up(memory, session)

    asyncio.run(scenario())
    assert [text for _, _, text in zep.saved] == ["Claude changed two files and", "and"]


def test_a_line_the_user_never_finished_is_saved_on_hang_up() -> None:
    zep = FakeZep()

    async def scenario() -> None:
        memory, session = call_with(zep)
        session.emit("conversation_item_added", said("user", "Hello", 1, "u1"))
        for text in ("My son", "My son loves strawberry"):
            session.emit(
                "user_input_transcribed",
                UserInputTranscribedEvent(
                    transcript=text, is_final=False, item_id="u2"
                ),
            )
        await hang_up(memory, session)

    asyncio.run(scenario())
    assert [text for _, _, text in zep.saved] == ["Hello", "My son loves strawberry"]


def test_a_finished_line_isnt_saved_twice() -> None:
    zep = FakeZep()

    async def scenario() -> None:
        memory, session = call_with(zep)
        session.emit(
            "user_input_transcribed",
            UserInputTranscribedEvent(transcript="Hello", is_final=False, item_id="u1"),
        )
        session.emit("conversation_item_added", said("user", "Hello", 1, "u1"))
        session.emit("conversation_item_added", said("user", "Hello", 1, "u1"))
        await hang_up(memory, session)

    asyncio.run(scenario())
    assert zep.saved == [("user", "Sam", "Hello")]


def test_a_call_where_the_user_says_nothing_leaves_no_thread() -> None:
    zep = FakeZep()

    async def scenario() -> None:
        memory, session = call_with(zep)
        session.emit(
            "conversation_item_added", said("assistant", "Hi Sam, what's up?", 1, "a0")
        )
        await hang_up(memory, session)

    asyncio.run(scenario())
    assert zep.requests == []


def test_without_a_name_the_users_lines_carry_none() -> None:
    zep = FakeZep()

    async def scenario() -> None:
        memory, session = call_with(zep, user_name="")
        session.emit("conversation_item_added", said("user", "Hello", 1, "u1"))
        await hang_up(memory, session)

    asyncio.run(scenario())
    assert zep.saved == [("user", None, "Hello")]


def test_a_failed_save_is_tried_again() -> None:
    zep = FakeZep(failing_adds=1)
    flagged: list[bool] = []

    async def scenario() -> None:
        memory, session = call_with(zep)

        async def unavailable() -> None:
            flagged.append(True)

        memory.on_unavailable(unavailable)
        session.emit("conversation_item_added", said("user", "Hello", 1, "u1"))
        await hang_up(memory, session)

    asyncio.run(scenario())
    assert zep.saved == [("user", "Sam", "Hello")]
    assert flagged == []


def test_zep_down_mid_call_tells_the_app_once(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(memory_module, "SAVE_RETRY_DELAY", 0)
    zep = FakeZep(failing_adds=10)
    flagged: list[bool] = []

    async def scenario() -> None:
        memory, session = call_with(zep)

        async def unavailable() -> None:
            flagged.append(True)

        memory.on_unavailable(unavailable)
        session.emit("conversation_item_added", said("user", "Hello", 1, "u1"))
        session.emit("conversation_item_added", said("user", "Still there?", 2, "u2"))
        await hang_up(memory, session)
        await asyncio.sleep(0)

    asyncio.run(scenario())
    assert zep.saved == []
    assert flagged == [True]


def test_hanging_up_saves_without_waiting_for_a_session_that_never_closes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(memory_module, "CLOSE_WAIT", 0.05)
    zep = FakeZep()

    async def scenario() -> None:
        memory, session = call_with(zep)
        session.emit("conversation_item_added", said("user", "Hello", 1, "u1"))
        await memory.aclose()

    asyncio.run(scenario())
    assert zep.saved == [("user", "Sam", "Hello")]


def test_a_typed_line_waits_behind_a_spoken_one_not_finalised_yet() -> None:
    zep = FakeZep()

    async def scenario() -> None:
        memory, session = call_with(zep)
        session.emit(
            "user_input_transcribed",
            UserInputTranscribedEvent(
                transcript="My son likes chocolate",
                is_final=False,
                item_id="u1",
                created_at=1,
            ),
        )
        session.emit(
            "conversation_item_added", said("user", "Actually, strawberry", 2, "t1")
        )
        await asyncio.sleep(0.05)
        assert zep.saved == []
        session.emit(
            "conversation_item_added", said("user", "My son likes chocolate", 1, "u1")
        )
        await hang_up(memory, session)

    asyncio.run(scenario())
    assert [text for _, _, text in zep.saved] == [
        "My son likes chocolate",
        "Actually, strawberry",
    ]


def test_lines_until_the_session_closes_are_saved_and_later_ones_left_out() -> None:
    zep = FakeZep()

    async def scenario() -> None:
        memory, session = call_with(zep)
        session.emit("conversation_item_added", said("user", "Hello", 1, "u1"))
        closing = asyncio.create_task(memory.aclose())
        await asyncio.sleep(0.05)
        # The session's teardown interrupts Bomby before it closes.
        session.emit(
            "conversation_item_added",
            said(
                "assistant", "Sure, I'll keep that in mind", 2, "a1", interrupted=True
            ),
        )
        session.emit("close", CloseEvent(reason=CloseReason.USER_INITIATED))
        await closing
        session.emit("conversation_item_added", said("user", "Too late", 3, "u2"))

    asyncio.run(scenario())
    assert [text for _, _, text in zep.saved] == [
        "Hello",
        "Sure, I'll keep that in mind",
    ]


def test_a_retry_after_a_lost_reply_saves_nothing_twice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(memory_module, "SAVE_RETRY_DELAY", 0)
    zep = FakeZep(lost_replies=1)

    async def scenario() -> None:
        memory, session = call_with(zep)
        session.emit("conversation_item_added", said("user", "Hello", 1, "u1"))
        await hang_up(memory, session)

    asyncio.run(scenario())
    assert zep.saved == [("user", "Sam", "Hello")]
    keys = [
        f["idempotency_key"]
        for name, f in zep.requests
        if name == "thread.add_messages"
    ]
    assert len(keys) == 2 and keys[0] == keys[1]


def test_telling_the_app_never_holds_up_a_recall(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(memory_module, "RECALL_BUDGET", 0.05)

    async def scenario() -> str:
        memory = Memory(FakeZep(slow=True), "user-uuid")  # pyright: ignore[reportArgumentType]

        async def stuck() -> None:
            await asyncio.sleep(60)

        memory.on_unavailable(stuck)
        async with asyncio.timeout(1):
            return await memory.recall("their son")

    assert asyncio.run(scenario()) == "You can't remember that right now."


def test_a_client_that_cant_be_made_leaves_the_call_without_memory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def broken(**_: object) -> FakeZep:
        raise OSError("bad proxy settings")

    monkeypatch.setattr(memory_module, "AsyncZep", broken)
    options = CallOptions(voice="Leda", memory_user="bomby-1")
    with pytest.raises(MemoryUnavailable):
        _ = asyncio.run(Memory.open(options, ZONE, ENV))
