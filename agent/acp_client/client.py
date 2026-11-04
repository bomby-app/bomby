"""The client side of ACP: answers an agent's requests and collects its replies."""

import asyncio
import logging
from collections.abc import Sequence
from typing import Any, final, override

from acp import RequestError
from acp.interfaces import Agent, Client
from acp.schema import (
    AgentMessageChunk,
    AllowedOutcome,
    CreateElicitationResponse,
    CreateTerminalResponse,
    DeniedOutcome,
    ElicitationMode,
    EnvVariable,
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

logger = logging.getLogger("bomby.acp_client.client")


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

    def __init__(self, harness: Harness) -> None:
        self._harness = harness
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
        option = pick_allow(options)
        if option is None:
            logger.warning("no allow option for %r, refusing", tool_call.title)
            return RequestPermissionResponse(outcome=DeniedOutcome(outcome="cancelled"))
        logger.info("approving %r (%s)", tool_call.title, option.kind)
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
