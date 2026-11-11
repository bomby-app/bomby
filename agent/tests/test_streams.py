"""The Agents panel's live streams (`acp_client/streams.py`), on the fake ACP agent and a
stand-in for the core's socket."""

import asyncio
import json
import os
import shutil
import sys
import tempfile
from collections.abc import AsyncGenerator, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, final

from acp import start_tool_call, text_block, update_agent_message

from acp_client.environment import APP_KEYS
from acp_client.runner import AcpRunner, Turn
from acp_client.streams import (
    CUT,
    MAX_MESSAGE,
    MAX_TITLE,
    SECRET_ENV,
    SOCKET_ENV,
    Recorder,
    StreamRecorder,
)
from harnesses import CLAUDE_CODE
from project import Project

FAKE_AGENT = Path(__file__).resolve().parent / "fake_claude_acp.py"


@final
class Core:
    """Stands in for the core's socket: every line each connection sent."""

    def __init__(self, path: str) -> None:
        self.path = path
        self.lines: list[dict[str, Any]] = []

    async def serve(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        while line := await reader.readline():
            self.lines.append(json.loads(line))
        writer.close()

    @property
    def events(self) -> list[dict[str, Any]]:
        return [line for line in self.lines if "type" in line]

    async def until(self, done: Callable[[list[dict[str, Any]]], bool]) -> None:
        for _ in range(200):
            if done(self.events):
                return
            await asyncio.sleep(0.05)
        raise AssertionError(f"the core never got what was expected: {self.events}")


@asynccontextmanager
async def core() -> AsyncGenerator[Core]:
    # Short, for a Unix socket's path; pytest's own temp folders can be too long.
    folder = tempfile.mkdtemp(prefix="bs-", dir="/tmp")
    stand_in = Core(os.path.join(folder, "s.sock"))
    server = await asyncio.start_unix_server(stand_in.serve, stand_in.path)
    try:
        yield stand_in
    finally:
        server.close()
        shutil.rmtree(folder, ignore_errors=True)


def runner(tmp_path: Path, streams: Recorder | None) -> AcpRunner:
    return AcpRunner(
        harness=CLAUDE_CODE,
        command=sys.executable,
        args=[str(FAKE_AGENT)],
        project=Project(name="test", folders=(tmp_path,)),
        env={**os.environ, "FAKE_ACP_LOG": str(tmp_path / "acp.jsonl")},
        streams=streams,
    )


async def prompted(tmp_path: Path) -> None:
    """Until the fake agent has its prompt, so a request sent now is steered in."""
    log = tmp_path / "acp.jsonl"
    for _ in range(400):
        if log.exists() and '"event": "prompt"' in log.read_text():
            return
        await asyncio.sleep(0.05)
    raise AssertionError("the agent never got its prompt")


def ended(events: list[dict[str, Any]]) -> bool:
    return any(e["type"] == "end" for e in events)


def test_a_turn_streams_its_messages_and_tool_calls_and_nothing_else(
    tmp_path: Path,
) -> None:
    async def main() -> tuple[Turn, Core]:
        async with core() as c:
            streams = StreamRecorder(c.path, "s3cret", "bomby-7-1")
            streams.start()
            r = runner(tmp_path, streams)
            try:
                turn = await r.run("stream all good", "landing-page")
                await c.until(ended)
            finally:
                await r.aclose()
                await streams.aclose()
            return turn, c

    turn, c = asyncio.run(main())

    # The result is what it always was.
    assert turn == Turn("Done: all good")
    assert c.lines[0] == {"secret": "s3cret", "room": "bomby-7-1"}
    title = "Run " + "x" * 300
    assert c.events == [
        {
            "type": "start",
            "stream": "1",
            "agent": "claude",
            "name": "Claude",
            "session": "landing-page",
        },
        {"type": "text", "stream": "1", "message": "m1", "text": "Let me look. "},
        {
            "type": "tool",
            "stream": "1",
            "id": "t1",
            "title": title[: MAX_TITLE - 1] + CUT,
            "kind": "execute",
            "status": "pending",
        },
        # The update with only content isn't sent.
        {"type": "tool", "stream": "1", "id": "t1", "status": "completed"},
        {
            "type": "tool",
            "stream": "1",
            "id": "t2",
            "title": "Read file",
            "status": "in_progress",
        },
        # The chunks of one message, sent together.
        {"type": "text", "stream": "1", "message": "m2", "text": "Done: all good"},
        {"type": "end", "stream": "1", "outcome": "done"},
    ]
    sent = json.dumps(c.lines)
    assert "Thinking" not in sent  # no thoughts
    assert 'secret": "x' not in sent and "output" not in sent  # no input or output


def test_a_steered_request_shares_the_turns_stream(tmp_path: Path) -> None:
    async def main() -> Core:
        async with core() as c:
            streams = StreamRecorder(c.path, "s", "bomby-1-1")
            streams.start()
            r = runner(tmp_path, streams)
            try:
                first = asyncio.create_task(r.run("wait landing page", "page"))
                await prompted(tmp_path)
                steered = await r.run("make the header blue", "page")
                assert steered.steered
                assert (await first).text == "Done: landing page + make the header blue"
                await c.until(ended)
            finally:
                await r.aclose()
                await streams.aclose()
            return c

    c = asyncio.run(main())

    assert [e["type"] for e in c.events] == ["start", "text", "end"]


def test_a_stopped_turn_ends_its_stream(tmp_path: Path) -> None:
    async def main() -> Core:
        async with core() as c:
            streams = StreamRecorder(c.path, "s", "bomby-1-1")
            streams.start()
            r = runner(tmp_path, streams)
            try:
                work = asyncio.create_task(r.run("hang", "page"))
                await c.until(lambda events: len(events) >= 1)
                _ = work.cancel()
                await c.until(ended)
            finally:
                await r.aclose()
                await streams.aclose()
            return c

    c = asyncio.run(main())

    assert [e["type"] for e in c.events] == ["start", "end"]
    # Not "done": the panel mustn't show a stopped turn's tool calls as completed.
    assert c.events[-1]["outcome"] == "stopped"


def tool(id: str) -> Any:
    return start_tool_call(id, f"Read {id}")


def test_a_full_queue_drops_events_and_says_so_but_keeps_start_and_end() -> None:
    async def main() -> Core:
        async with core() as c:
            # Filled before anything is sent, as when the socket is stuck.
            streams = StreamRecorder(c.path, "s", "bomby-1-1", max_pending=3)
            streams.open("a", "codex", "Codex", "api")
            for id in ("t1", "t2", "t3", "t4"):
                streams.record("a", tool(id))
            streams.close("a", "done")
            streams.start()
            try:
                await c.until(ended)
            finally:
                await streams.aclose()
            return c

    c = asyncio.run(main())

    assert [(e["type"], e.get("id")) for e in c.events] == [
        ("start", None),
        ("tool", "t1"),
        ("tool", "t2"),
        ("dropped", None),
        ("end", None),
    ]


def test_a_message_is_cut_to_its_cap_and_the_next_one_starts_afresh() -> None:
    async def main() -> Core:
        async with core() as c:
            streams = StreamRecorder(c.path, "s", "bomby-1-1")
            streams.open("a", "goose", "goose", "main")

            def say(text: str, message: str) -> None:
                chunk = update_agent_message(text_block(text))
                chunk.message_id = message
                streams.record("a", chunk)

            say("x" * (MAX_MESSAGE + 500), "m1")
            say("more", "m1")
            say("next", "m2")
            streams.close("a", "done")
            streams.start()
            try:
                await c.until(ended)
            finally:
                await streams.aclose()
            return c

    c = asyncio.run(main())

    texts = [e for e in c.events if e["type"] == "text"]
    assert len(texts[0]["text"]) == MAX_MESSAGE
    assert texts[0]["text"].endswith(CUT)
    assert texts[1] == {"type": "text", "stream": "1", "message": "m2", "text": "next"}


def test_without_the_app_there_is_no_stream() -> None:
    assert StreamRecorder.from_env("bomby-1-1", {}) is None
    assert StreamRecorder.from_env("r", {SOCKET_ENV: "/x", SECRET_ENV: "s"}) is not None


def test_an_unreachable_core_leaves_the_result_as_it_is(tmp_path: Path) -> None:
    async def main() -> Turn:
        streams = StreamRecorder("/tmp/bomby-no-such.sock", "s", "bomby-1-1")
        streams.start()
        r = runner(tmp_path, streams)
        try:
            return await r.run("stream all good")
        finally:
            await r.aclose()
            await streams.aclose()

    assert asyncio.run(main()) == Turn("Done: all good")


@final
class Broken:
    """A recorder whose every update fails."""

    def __init__(self) -> None:
        self.opened: list[str] = []

    def open(self, session_id: str, agent: str, name: str, session: str) -> None:
        self.opened.append(f"{agent}/{name}/{session}/{session_id}")

    def record(self, session_id: str, update: Any) -> None:
        raise RuntimeError(f"recorder bug on {session_id}: {update!r}")

    def close(self, session_id: str, outcome: str) -> None:
        del outcome
        self.opened.remove(next(o for o in self.opened if o.endswith(session_id)))


def test_a_recorder_that_raises_leaves_the_result_as_it_is(tmp_path: Path) -> None:
    async def main() -> Turn:
        r = runner(tmp_path, Broken())
        try:
            return await r.run("stream all good")
        finally:
            await r.aclose()

    assert asyncio.run(main()) == Turn("Done: all good")


def test_the_streams_socket_never_reaches_a_coding_agent() -> None:
    assert {SOCKET_ENV, SECRET_ENV} <= APP_KEYS
