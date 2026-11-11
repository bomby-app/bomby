"""What each coding agent says and does in a turn, sent live to the app's core for the
Agents panel (docs/decisions/agent-streams-through-the-core.md).

The client hands every `session/update` of a running turn to `StreamRecorder.record`, which
keeps only the agent's message text and each tool call's id, title, kind and status, cuts
them to size, and queues them. Nothing waits on the app: a task's result never depends on
it. Another task sends the queue to the core over a local socket about every 100 ms; the
core keeps the call's turns in memory and passes them to the page. Nothing is kept once
the call ends, and nothing is logged.

The core starts the worker with the socket's path in `BOMBY_STREAMS` and the run's secret in
`BOMBY_STREAMS_SECRET` (`app/src-tauri/src/agent_streams.rs`). Console runs have neither,
so they don't stream. One connection per call, each line a JSON object: first
`{"secret": "…", "room": "<the call's room>"}`, then events:

    {"type": "start", "stream": "1", "agent": "claude", "name": "Claude", "session": "landing-page"}
    {"type": "text", "stream": "1", "message": "<the agent's message id, or null>", "text": "…"}
    {"type": "tool", "stream": "1", "id": "…", "title"?: "…", "kind"?: "execute", "status"?: "in_progress"}
    {"type": "dropped", "stream": "1"}
    {"type": "end", "stream": "1", "outcome": "done"}

`text` appends to the message; `tool` is a patch, by id, of the fields it has; `dropped`
says some events before it were left out (the queue was full); `end` says how the turn
ended (`Outcome`), so the panel doesn't show a stopped turn's tool calls as completed.
"""

import asyncio
import contextlib
import json
import logging
import os
from collections import deque
from collections.abc import Mapping
from typing import Any, Literal, Protocol, final

from acp.schema import (
    AgentMessageChunk,
    TextContentBlock,
    ToolCallProgress,
    ToolCallStart,
)

logger = logging.getLogger("bomby.acp_client.streams")

Outcome = Literal["done", "stopped", "failed"]
"""How a turn ended: the agent finished it (`done`), it was stopped or stopped early
(`stopped`: a cancel, or a stop reason other than `end_turn`), or it broke (`failed`)."""

SOCKET_ENV = "BOMBY_STREAMS"
SECRET_ENV = "BOMBY_STREAMS_SECRET"
# Caps, applied before anything is serialized. A tool call's title can be a whole command
# line; a message is the agent's own prose, long only when it reports.
MAX_TITLE = 200
MAX_ID = 200
MAX_MESSAGE = 16_000
CUT = "…"
# How many events may wait for the socket. Consecutive text of one message is one event,
# so this is a few seconds of a busy agent; beyond it, events are dropped, never waited on.
MAX_PENDING = 1000
# How long text gathers before it's sent, so a token-by-token agent is ten writes a second.
BATCH_S = 0.1
# How long connecting or a write may take before streaming stops for the call.
WRITE_TIMEOUT_S = 5


class Recorder(Protocol):
    """Where the runner and client report a turn's activity. Nothing here may await."""

    def open(self, session_id: str, agent: str, name: str, session: str) -> None:
        """A turn starts in ACP session `session_id`, the call's session `session` of the
        agent `agent` (a harness id), called `name` ("Claude")."""
        ...

    def record(self, session_id: str, update: Any) -> None:
        """One `session/update` for `session_id`; ignored when no turn runs there."""
        ...

    def close(self, session_id: str, outcome: Outcome) -> None:
        """The turn in `session_id` is over, and how it ended."""
        ...


def cut(text: str, limit: int) -> str:
    """`text` within `limit` characters, ending in `CUT` when it was longer."""
    return text if len(text) <= limit else text[: limit - len(CUT)] + CUT


@final
class _Stream:
    """A running turn's stream, and how much of its current message was kept."""

    def __init__(self, key: str) -> None:
        self.key = key
        self.message: str | None = None
        self.chars = 0


@final
class StreamRecorder:
    """Turns a call's ACP updates into stream events and sends them to the core."""

    def __init__(
        self, path: str, secret: str, room: str, max_pending: int = MAX_PENDING
    ) -> None:
        self._path = path
        self._secret = secret
        self._room = room
        self._max_pending = max_pending
        self._streams: dict[str, _Stream] = {}  # by ACP session id
        self._next = 1
        self._pending: deque[dict[str, Any]] = deque()
        self._dropped: set[str] = (
            set()
        )  # streams with events left out since the last sent
        self._wake = asyncio.Event()
        self._live = True  # false once the socket failed: the call doesn't stream
        self._sender: asyncio.Task[None] | None = None

    @classmethod
    def from_env(
        cls, room: str, environ: Mapping[str, str] = os.environ
    ) -> "StreamRecorder | None":
        """The core's socket for the call in `room`, or None outside the app (console
        runs)."""
        path, secret = environ.get(SOCKET_ENV), environ.get(SECRET_ENV)
        if not path or not secret:
            return None
        return cls(path, secret, room)

    def start(self) -> None:
        """Starts sending, on the running loop."""
        if self._sender is None:
            self._sender = asyncio.create_task(self._send())

    async def aclose(self) -> None:
        """Stops sending; the core ends whatever streams were still open."""
        self._live = False
        if self._sender is not None:
            _ = self._sender.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._sender

    # The recorder's side: synchronous, guarded, never raises into the caller.

    def open(self, session_id: str, agent: str, name: str, session: str) -> None:
        try:
            if not self._live:
                return
            stream = _Stream(str(self._next))
            self._next += 1
            self._streams[session_id] = stream
            self._emit(
                {
                    "type": "start",
                    "stream": stream.key,
                    "agent": agent,
                    "name": name,
                    "session": cut(session, MAX_ID),
                },
                keep=True,
            )
        except Exception:
            logger.exception("recording a turn's start failed")

    def close(self, session_id: str, outcome: Outcome) -> None:
        try:
            stream = self._streams.pop(session_id, None)
            if stream is not None and self._live:
                self._emit(
                    {"type": "end", "stream": stream.key, "outcome": outcome},
                    keep=True,
                )
        except Exception:
            logger.exception("recording a turn's end failed")

    def record(self, session_id: str, update: Any) -> None:
        stream = self._streams.get(session_id)
        if stream is None or not self._live:
            return
        event = self._event(stream, update)
        if event is not None:
            self._emit(event)

    def _event(self, stream: _Stream, update: Any) -> dict[str, Any] | None:
        """Bomby's event for `update`: only the standard fields it shows, cut to size."""
        if isinstance(update, AgentMessageChunk):
            if not isinstance(update.content, TextContentBlock):
                return None
            message = update.message_id
            if message is not None:
                message = cut(message, MAX_ID)
            if message != stream.message:
                stream.message, stream.chars = message, 0
            room = MAX_MESSAGE - stream.chars
            if room <= 0:
                return None
            text = update.content.text
            if len(text) > room:
                text = text[: room - len(CUT)] + CUT
            stream.chars += min(room, len(text))
            return {
                "type": "text",
                "stream": stream.key,
                "message": message,
                "text": text,
            }
        if isinstance(update, ToolCallStart | ToolCallProgress):
            # A tool call ends the message before it, as in the final message's `Reply`.
            stream.message, stream.chars = None, 0
            event: dict[str, Any] = {
                "type": "tool",
                "stream": stream.key,
                "id": cut(update.tool_call_id, MAX_ID),
            }
            if update.title is not None:
                event["title"] = cut(update.title, MAX_TITLE)
            if update.kind is not None:
                event["kind"] = update.kind
            status = update.status
            if status is None and isinstance(update, ToolCallStart):
                status = "pending"  # ACP's default for a new tool call
            if status is not None:
                event["status"] = status
            # An update with only output, content or a diff changes nothing shown.
            if isinstance(update, ToolCallProgress) and len(event) == 3:
                return None
            return event
        return None

    def _emit(self, event: dict[str, Any], keep: bool = False) -> None:
        """Queues `event`; when the queue is full, drops it and remembers to say so. Text
        that continues the last event's message joins it. A stream's start and end are
        always kept, so the core never holds a turn that's over."""
        key = event["stream"]
        last = self._pending[-1] if self._pending else None
        if (
            event["type"] == "text"
            and last is not None
            and last["type"] == "text"
            and last["stream"] == key
            and last["message"] == event["message"]
            and key not in self._dropped
        ):
            last["text"] += event["text"]
            return
        if not keep and len(self._pending) >= self._max_pending:
            self._dropped.add(key)
            return
        if key in self._dropped:
            self._dropped.discard(key)
            self._pending.append({"type": "dropped", "stream": key})
        self._pending.append(event)
        self._wake.set()

    # The sender's side.

    async def _send(self) -> None:
        writer: asyncio.StreamWriter | None = None
        try:
            async with asyncio.timeout(WRITE_TIMEOUT_S):
                _, writer = await asyncio.open_unix_connection(self._path)
                writer.write(self._line({"secret": self._secret, "room": self._room}))
                await writer.drain()
            while True:
                _ = await self._wake.wait()
                await asyncio.sleep(BATCH_S)  # text gathers in the meantime
                self._wake.clear()
                lines = b"".join(self._line(e) for e in self._pending)
                self._pending.clear()
                writer.write(lines)
                async with asyncio.timeout(WRITE_TIMEOUT_S):
                    await writer.drain()
        except (OSError, TimeoutError, ValueError) as e:
            # The page goes without; the call and its tasks go on.
            logger.warning("the agents' streams can't reach the app: %r", e)
        finally:
            self._live = False
            self._pending.clear()
            self._streams.clear()
            if writer is not None:
                writer.close()

    @staticmethod
    def _line(event: dict[str, Any]) -> bytes:
        return json.dumps(event, ensure_ascii=False).encode() + b"\n"
