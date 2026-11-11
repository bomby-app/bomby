"""The client side of ACP: answers an agent's requests and collects its replies."""

import asyncio
import contextlib
import logging
from collections.abc import AsyncGenerator, Mapping, Sequence
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, final, override

from acp import PROTOCOL_VERSION, RequestError, spawn_agent_process
from acp.client.connection import ClientSideConnection
from acp.interfaces import Agent, Client
from acp.schema import (
    AgentMessageChunk,
    AllowedOutcome,
    ClientCapabilities,
    CreateElicitationResponse,
    CreateTerminalResponse,
    DeniedOutcome,
    ElicitationMode,
    EnvVariable,
    Implementation,
    InitializeResponse,
    KillTerminalResponse,
    PermissionOption,
    ReadTextFileResponse,
    ReleaseTerminalResponse,
    RequestPermissionResponse,
    TerminalOutputResponse,
    TextContentBlock,
    ToolCallStart,
    ToolCallUpdate,
    WaitForTerminalExitResponse,
    WriteTextFileResponse,
)

from harnesses.harness import Harness

from .streams import Recorder

logger = logging.getLogger("bomby.acp_client.client")

CLIENT_INFO = Implementation(name="bomby", version="0.3.0")
# The SDK's read buffer per line. It reassembles longer lines anyway; this only saves
# round trips on large messages. Matches the SDK's agent side.
STDIO_LIMIT = 50 * 1024 * 1024


@asynccontextmanager
async def connect(
    client: Client,
    command: str,
    args: Sequence[str],
    *,
    env: Mapping[str, str],
    cwd: Path,
) -> AsyncGenerator[
    tuple[ClientSideConnection, asyncio.subprocess.Process, InitializeResponse]
]:
    """Starts an agent over ACP and initializes it: the connection, its process and what
    `initialize` said. Leaving the context stops the process. Its stderr goes to the debug
    log, which also keeps the pipe drained (the adapter blocks once it fills)."""
    async with spawn_agent_process(
        client,
        command,
        *args,
        env=dict(env),
        cwd=cwd,
        transport_kwargs={"limit": STDIO_LIMIT},
    ) as (conn, process):
        stderr = asyncio.create_task(_log_stderr(command, process.stderr))
        try:
            init = await conn.initialize(
                protocol_version=PROTOCOL_VERSION,
                client_capabilities=ClientCapabilities(),
                client_info=CLIENT_INFO,
            )
            yield conn, process, init
        finally:
            _ = stderr.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await stderr


async def _log_stderr(command: str, stream: asyncio.StreamReader | None) -> None:
    if stream is None:
        return
    while line := await stream.readline():
        logger.debug("%s: %s", command, line.decode(errors="replace").rstrip())


def pick_allow(options: Sequence[PermissionOption]) -> PermissionOption | None:
    """The option that approves a permission request.

    `allow_once` first: `allow_always` makes an agent like Claude Code write a rule to its
    settings.
    """
    for kind in ("allow_once", "allow_always"):
        for option in options:
            if option.kind == kind:
                return option
    return None


@final
class Reply:
    """The agent's latest assistant message in one session.

    Text before a tool call is narration ("let me check..."), so a tool call or a new
    message id starts over. What is left when the turn ends is the final message.
    """

    def __init__(self) -> None:
        self._message_id: str | None = None
        self._parts: list[str] = []

    def add(self, message_id: str | None, text: str) -> None:
        if message_id != self._message_id:
            self.reset()
            self._message_id = message_id
        self._parts.append(text)

    def reset(self) -> None:
        self._message_id = None
        self._parts = []

    @property
    def text(self) -> str:
        return "".join(self._parts).strip()


@final
class HarnessClient(Client):
    """Answers one harness's requests and collects its replies.

    initialize advertises no file system, terminal or elicitation support, so the agent does
    its own file and shell work; those methods only refuse, in case they are called anyway.
    """

    def __init__(self, harness: Harness, streams: Recorder | None = None) -> None:
        self._harness = harness
        self._streams = streams  # the Agents panel's live view; None on console runs
        self.replies: dict[str, Reply] = {}
        self.auth_status: dict[str, Any] | None = None
        """The identity the agent last reported through the `authStatus` extension
        (docs/acp-notes.md#setup-signals), e.g. `{"kind": "account", "label": "Claude Max"}`."""
        self.auth_reported = asyncio.Event()

    @override
    async def request_permission(
        self,
        session_id: str,
        tool_call: ToolCallUpdate,
        options: list[PermissionOption],
        **kwargs: Any,
    ) -> RequestPermissionResponse:
        # Sessions run in the harness's bypass mode; this only catches what still asks.
        # By kind, never title: a title can be a whole command line, with a token in it.
        option = pick_allow(options)
        kind = tool_call.kind or "a tool"
        if option is None:
            logger.warning("no allow option for %s, refusing", kind)
            return RequestPermissionResponse(outcome=DeniedOutcome(outcome="cancelled"))
        logger.info("approving %s (%s)", kind, option.kind)
        return RequestPermissionResponse(
            outcome=AllowedOutcome(outcome="selected", option_id=option.option_id)
        )

    @override
    async def session_update(self, session_id: str, update: Any, **kwargs: Any) -> None:
        # Never await in here. The SDK runs each notification as its own task but resolves
        # the prompt response inline, so the turn's last chunks are only in the reply
        # before `prompt` returns because this handler never suspends. Anything slow, such
        # as status events to the app, goes on a queue drained by another task.
        reply = self.replies.get(session_id)
        if reply is None:
            return
        if isinstance(update, AgentMessageChunk) and isinstance(
            update.content, TextContentBlock
        ):
            reply.add(update.message_id, update.content.text)
        elif isinstance(update, ToolCallStart):
            reply.reset()
        # After the reply, and guarded: the Agents panel's stream must never touch or
        # delay a result (`streams.py`). It only queues.
        if self._streams is not None:
            try:
                self._streams.record(session_id, self._harness.id, update)
            except Exception:
                logger.exception("recording %s's update failed", self._harness.id)

    @override
    async def ext_method(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        raise RequestError.method_not_found(method)

    @override
    async def ext_notification(self, method: str, params: dict[str, Any]) -> None:
        logger.info("%s %s: %s", self._harness.id, method, params)
        status = params.get("authStatus")
        if method == "auth/status_update" and isinstance(status, dict):
            self.auth_status = status
            self.auth_reported.set()

    @override
    def on_connect(self, conn: Agent) -> None:
        pass

    # Not advertised in initialize, so never expected.

    @override
    async def write_text_file(
        self, session_id: str, path: str, content: str, **kwargs: Any
    ) -> WriteTextFileResponse | None:
        raise RequestError.method_not_found("fs/write_text_file")

    @override
    async def read_text_file(
        self,
        session_id: str,
        path: str,
        line: int | None = None,
        limit: int | None = None,
        **kwargs: Any,
    ) -> ReadTextFileResponse:
        raise RequestError.method_not_found("fs/read_text_file")

    @override
    async def create_terminal(
        self,
        session_id: str,
        command: str,
        args: list[str] | None = None,
        env: list[EnvVariable] | None = None,
        cwd: str | None = None,
        output_byte_limit: int | None = None,
        **kwargs: Any,
    ) -> CreateTerminalResponse:
        raise RequestError.method_not_found("terminal/create")

    @override
    async def terminal_output(
        self, session_id: str, terminal_id: str, **kwargs: Any
    ) -> TerminalOutputResponse:
        raise RequestError.method_not_found("terminal/output")

    @override
    async def release_terminal(
        self, session_id: str, terminal_id: str, **kwargs: Any
    ) -> ReleaseTerminalResponse | None:
        raise RequestError.method_not_found("terminal/release")

    @override
    async def wait_for_terminal_exit(
        self, session_id: str, terminal_id: str, **kwargs: Any
    ) -> WaitForTerminalExitResponse:
        raise RequestError.method_not_found("terminal/wait_for_exit")

    @override
    async def kill_terminal(
        self, session_id: str, terminal_id: str, **kwargs: Any
    ) -> KillTerminalResponse | None:
        raise RequestError.method_not_found("terminal/kill")

    @override
    async def create_elicitation(
        self, message: str, mode: ElicitationMode, **kwargs: Any
    ) -> CreateElicitationResponse:
        raise RequestError.method_not_found("elicitation/create")

    @override
    async def complete_elicitation(self, elicitation_id: str, **kwargs: Any) -> None:
        raise RequestError.method_not_found("elicitation/complete")
