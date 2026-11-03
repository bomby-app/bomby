"""The `claude` tool: hand a task to Claude Code over ACP and return its final message.

A call works on one project, through one `claude-agent-acp` process. The voice model names
a session per piece of work; sessions run in parallel, and each keeps its context from
request to request. A request to a session that is still working is steered into its
running turn. The voice model only ever sees Claude's final message, as the tool result,
when a turn ends.
"""

import asyncio
import contextlib
import json
import logging
import os
from collections.abc import Mapping, Sequence
from contextlib import AsyncExitStack
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast, final, override

from acp import PROTOCOL_VERSION, RequestError, spawn_agent_process, text_block
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
    NewSessionResponse,
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
from dotenv import dotenv_values
from livekit.agents import RunContext
from livekit.agents.llm import ToolError, ToolFlag, function_tool

logger = logging.getLogger("claudible.tools.claude")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SYSTEM_PROMPT = (PROJECT_ROOT / "prompts" / "claude-system-prompt.md").read_text()

DEFAULT_COMMAND = "claude-agent-acp"
BYPASS_MODE = "bypassPermissions"
# The SDK's read buffer per line. It reassembles longer lines anyway; this only saves
# round trips on large messages. Matches the SDK's agent side.
STDIO_LIMIT = 50 * 1024 * 1024
CLOSE_TIMEOUT_S = 5
# Never passed to Claude. With an API key in its environment Claude Code bills the API
# account instead of the Claude plan. Claude Code sets CLAUDECODE in its own shells and
# refuses to start under it, which would break running this agent from a Claude terminal.
# The desktop app starts this agent with the user's LiveKit and Gemini keys in its
# environment (not in .env), so those names are blocked here too.
BLOCKED_ENV = frozenset(
    {
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "CLAUDECODE",
        "LIVEKIT_URL",
        "LIVEKIT_API_KEY",
        "LIVEKIT_API_SECRET",
        "GOOGLE_API_KEY",
        "GEMINI_API_KEY",
    }
)
# claude-agent-acp's extension for injecting a message into a running turn. The SDK sends
# it as `_session/steering`; initialize advertises it in `_meta.steering.supported`.
STEER_METHOD = "session/steering"
STEERED = (
    "Claude got this while it was still working, and is folding it into the task that "
    + "is running. That task's result covers it."
)
DEFAULT_PROJECT = "home"
DEFAULT_SESSION = "main"


@dataclass(frozen=True)
class Project:
    """What one call works on: a name and the folders Claude works in.

    The first folder is Claude's working directory and the rest are added as extra
    directories. They tell Claude where the project lives; they don't fence it in, since
    sessions bypass permissions.
    """

    name: str
    folders: tuple[Path, ...]

    @property
    def cwd(self) -> Path:
        return self.folders[0]

    @property
    def extra_folders(self) -> list[str]:
        return [str(folder) for folder in self.folders[1:]]

    @classmethod
    def from_job(cls, metadata: str, environ: Mapping[str, str]) -> "Project":
        """The project from the job's dispatch metadata, else from the environment.

        Metadata is JSON, `{"project": "samba", "folders": ["/abs/path", ...]}`. Console
        runs have no metadata, so `CLAUDE_PROJECT` and `CLAUDE_FOLDERS` (separated by
        `os.pathsep`) stand in. Without folders, the project is the home folder.
        """
        name: object
        folders: object
        if metadata.strip():
            data = cast(object, json.loads(metadata))
            if not isinstance(data, dict):
                raise ValueError("job metadata must be a JSON object")
            fields = cast(dict[str, object], data)
            name, folders = fields.get("project"), fields.get("folders")
            if folders is None:
                folders = []
        else:
            name = environ.get("CLAUDE_PROJECT")
            folders = [
                f for f in environ.get("CLAUDE_FOLDERS", "").split(os.pathsep) if f
            ]

        items = cast(list[object], folders) if isinstance(folders, list) else None
        if items is None or not all(isinstance(f, str) for f in items):
            raise ValueError("project folders must be a list of paths")
        paths = tuple(Path(cast(str, f)) for f in items) or (Path.home(),)
        for path in paths:
            if not path.is_absolute():
                raise ValueError(f"project folder must be an absolute path: {path}")
            if not path.is_dir():
                raise ValueError(f"project folder does not exist: {path}")
        if not isinstance(name, str) or not name.strip():
            name = DEFAULT_PROJECT
        return cls(name=name.strip(), folders=paths)


def child_environment(
    environ: Mapping[str, str], dotenv_keys: set[str]
) -> dict[str, str]:
    """The environment Claude runs with: the shell's, minus this agent's `.env` secrets."""
    return {
        k: v
        for k, v in environ.items()
        if k not in dotenv_keys and k not in BLOCKED_ENV
    }


def pick_allow(options: Sequence[PermissionOption]) -> PermissionOption | None:
    """The option that approves a permission request.

    `allow_once` first: `allow_always` makes Claude Code write a rule to its settings.
    """
    for kind in ("allow_once", "allow_always"):
        for option in options:
            if option.kind == kind:
                return option
    return None


@final
class _Reply:
    """Claude's latest assistant message in one session.

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
class _ClaudeClient(Client):
    """The client side of ACP: answers Claude's requests and collects its replies.

    initialize advertises no file system, terminal or elicitation support, so Claude does
    its own file and shell work; those methods only refuse, in case they are called anyway.
    """

    def __init__(self) -> None:
        self.replies: dict[str, _Reply] = {}

    @override
    async def request_permission(
        self,
        session_id: str,
        tool_call: ToolCallUpdate,
        options: list[PermissionOption],
        **kwargs: Any,
    ) -> RequestPermissionResponse:
        # Sessions run in bypassPermissions mode; this only catches what still asks.
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
        # claude-agent-acp pushes which account it runs as (`_auth/status_update`).
        logger.info("claude-agent-acp %s: %s", method, params)

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


async def _log_stderr(stream: asyncio.StreamReader | None) -> None:
    # The pipe must be drained, or the adapter blocks once it fills.
    if stream is None:
        return
    while line := await stream.readline():
        logger.debug("claude-agent-acp: %s", line.decode(errors="replace").rstrip())


def session_name(name: str) -> str:
    """The key a session is known by: lowercase words joined by dashes ("Samba page" is
    "samba-page"), so the voice model can't open a second session by changing case."""
    return "-".join(name.lower().split()) or DEFAULT_SESSION


@final
class _Session:
    """One named Claude session in the call."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.id: str | None = None
        self.conn: ClientSideConnection | None = None
        self.open_lock = asyncio.Lock()  # opening the ACP session
        self.turn_lock = asyncio.Lock()  # held while a prompt turn runs


@final
class ClaudeRunner:
    """Runs one call's Claude work: one `claude-agent-acp` process, named sessions in it.

    Every session works on the call's project. A session opens on its first task and
    stays open until the call ends, so a request to the same name continues the same
    conversation. Sessions run in parallel; within one, a single turn runs at a time, and
    a request that arrives mid-turn is steered into it (or waits for it when the adapter
    can't steer).
    """

    def __init__(
        self,
        *,
        command: str,
        args: Sequence[str] = (),
        project: Project,
        env: Mapping[str, str],
    ) -> None:
        self._command = command
        self._args = tuple(args)
        self._project = project
        self._env = dict(env)
        self._client = _ClaudeClient()
        self._lock = asyncio.Lock()  # the process
        self._stack: AsyncExitStack | None = None
        self._conn: ClientSideConnection | None = None
        self._process: asyncio.subprocess.Process | None = None
        self._stderr_task: asyncio.Task[None] | None = None
        self._can_close = False
        self._can_steer = False
        self._conn_failed = False  # a request saw the connection drop
        self._closed = False  # the call ended: refuse new work
        self._sessions: dict[str, _Session] = {}

    @classmethod
    def from_env(cls, metadata: str = "") -> "ClaudeRunner":
        """A runner for the project in the job's metadata (see `Project.from_job`)."""
        dotenv_keys = set(dotenv_values(PROJECT_ROOT / ".env"))
        return cls(
            command=os.getenv("CLAUDE_ACP_BIN") or DEFAULT_COMMAND,
            project=Project.from_job(metadata, os.environ),
            env=child_environment(os.environ, dotenv_keys),
        )

    @property
    def project(self) -> Project:
        return self._project

    def is_busy(self, name: str) -> bool:
        """Whether the session called `name` has a turn running."""
        session = self._sessions.get(session_name(name))
        return session is not None and session.turn_lock.locked()

    async def run(self, task: str, session: str = DEFAULT_SESSION) -> str:
        """Send `task` to the session called `session`; return Claude's final message.

        A new name opens a new Claude session. Mid-turn, the task is steered into the
        running turn and this returns `STEERED` at once: that turn's result answers it.
        """
        if self._closed:
            raise ToolError("The call is ending; Claude takes no new work.")
        s = self._sessions.setdefault(
            session_name(session), _Session(session_name(session))
        )
        if s.turn_lock.locked() and self._can_steer:
            conn, session_id = await self._open(s)
            if await self._steer(conn, s, session_id, task):
                return STEERED
        async with s.turn_lock:
            conn, session_id = await self._open(s)
            return await self._prompt(conn, s, session_id, task)

    async def aclose(self) -> None:
        """Close every session, then the adapter process. No new work after this."""
        self._closed = True
        for s in list(self._sessions.values()):
            async with s.open_lock:
                session_id, conn, s.id, s.conn = s.id, s.conn, None, None
                if session_id is not None and conn is not None:
                    await self._close_session(conn, session_id)
        async with self._lock:
            await self._teardown()

    async def _open(self, s: _Session) -> tuple[ClientSideConnection, str]:
        try:
            return await self._open_session(s)
        except (OSError, RequestError, ConnectionError) as e:
            raise ToolError(f"Claude Code could not start: {e}") from e

    async def _open_session(self, s: _Session) -> tuple[ClientSideConnection, str]:
        async with s.open_lock:
            if self._closed:
                raise ConnectionError("the call ended")
            conn = await self._connection()
            if s.id is not None and s.conn is conn:
                return conn, s.id
            if s.id is not None:
                logger.warning(
                    "claude-agent-acp restarted: session %s continues as a new Claude "
                    + "session, without the earlier context",
                    s.name,
                )
            try:
                created = await conn.new_session(
                    cwd=str(self._project.cwd),
                    additional_directories=self._project.extra_folders or None,
                    mcp_servers=[],
                    systemPrompt={"append": SYSTEM_PROMPT},
                )
                await self._bypass_permissions(conn, created)
            except ConnectionError:
                self._connection_lost(conn)
                raise
            s.id, s.conn = created.session_id, conn
            logger.info(
                "claude session %s (%s) opened for project %s in %s",
                s.name,
                created.session_id,
                self._project.name,
                ", ".join(str(f) for f in self._project.folders),
            )
            return conn, created.session_id

    async def _prompt(
        self, conn: ClientSideConnection, s: _Session, session_id: str, task: str
    ) -> str:
        reply = self._client.replies[session_id] = _Reply()
        logger.info("claude turn in %s started: %s", s.name, task)
        try:
            response = await conn.prompt(
                session_id=session_id, prompt=[text_block(task)]
            )
        except asyncio.CancelledError:
            # Stop the turn, keep the session: the next request continues it.
            with contextlib.suppress(Exception):
                await asyncio.shield(conn.cancel(session_id=session_id))
            raise
        except ConnectionError as e:
            self._connection_lost(conn)
            raise ToolError(f"Claude Code failed: {e}") from e
        except RequestError as e:
            raise ToolError(f"Claude Code failed: {e}") from e
        finally:
            _ = self._client.replies.pop(session_id, None)

        logger.info("claude turn in %s ended: %s", s.name, response.stop_reason)
        text = reply.text or "Claude finished without a final message."
        if response.stop_reason != "end_turn":
            text = f"Claude stopped early ({response.stop_reason}). Its last message: {text}"
        logger.info("claude turn in %s result: %s", s.name, text)
        return text

    async def _steer(
        self, conn: ClientSideConnection, s: _Session, session_id: str, task: str
    ) -> bool:
        """Inject `task` into the running turn. False when no turn is running any more."""
        try:
            result = await conn.ext_method(
                STEER_METHOD,
                {
                    "sessionId": session_id,
                    "prompt": [text_block(task).model_dump(by_alias=True)],
                    # Without this, an idle session would start a turn nobody waits on.
                    "_meta": {"steering": {"idleBehavior": "promptRequired"}},
                },
            )
        except (RequestError, ConnectionError) as e:
            if isinstance(e, ConnectionError):
                self._connection_lost(conn)
            logger.warning("steering into %s failed (%s), queueing instead", s.name, e)
            return False
        outcome = result.get("outcome")
        logger.info("claude steer into %s: %s: %s", s.name, outcome, task)
        return outcome != "promptRequired"

    def _connection_lost(self, conn: ClientSideConnection) -> None:
        """Mark `conn` dead, so the next request starts a fresh adapter.

        The SDK fails requests as soon as the adapter's stdout closes, but the process is
        reaped later, so its return code alone would hand the dead connection back out.
        """
        if conn is self._conn:
            self._conn_failed = True

    async def _connection(self) -> ClientSideConnection:
        async with self._lock:
            if self._closed:
                raise ConnectionError("the call ended")
            if (
                self._conn is not None
                and not self._conn_failed
                and self._process is not None
                and self._process.returncode is None
            ):
                return self._conn
            await self._teardown()  # the adapter died: start a fresh one

            stack = AsyncExitStack()
            try:
                conn, process = await stack.enter_async_context(
                    spawn_agent_process(
                        self._client,
                        self._command,
                        *self._args,
                        env=self._env,
                        cwd=self._project.cwd,
                        transport_kwargs={"limit": STDIO_LIMIT},
                    )
                )
                self._stderr_task = asyncio.create_task(_log_stderr(process.stderr))
                init = await conn.initialize(
                    protocol_version=PROTOCOL_VERSION,
                    client_capabilities=ClientCapabilities(),
                    client_info=Implementation(name="claudible", version="0.1.0"),
                )
            except BaseException:
                await self._cancel_stderr_task()
                await stack.aclose()
                raise
            self._stack, self._conn, self._process = stack, conn, process
            self._conn_failed = False
            self._read_capabilities(init)
            logger.info("claude-agent-acp started (pid %s)", process.pid)
            return conn

    def _read_capabilities(self, init: InitializeResponse) -> None:
        capabilities = init.agent_capabilities
        sessions = capabilities.session_capabilities if capabilities else None
        self._can_close = sessions is not None and sessions.close is not None
        steering: object = (init.field_meta or {}).get("steering")
        self._can_steer = (
            isinstance(steering, dict) and steering.get("supported") is True  # pyright: ignore[reportUnknownMemberType]
        )
        if not self._can_steer:
            logger.warning("claude-agent-acp can't steer: mid-turn requests will wait")

    async def _bypass_permissions(
        self, conn: ClientSideConnection, session: NewSessionResponse
    ) -> None:
        modes = session.modes
        if modes is None or all(
            mode.id != BYPASS_MODE for mode in modes.available_modes
        ):
            logger.warning(
                "%s is not offered; approving permission requests instead", BYPASS_MODE
            )
            return
        if modes.current_mode_id == BYPASS_MODE:
            return
        try:
            _ = await conn.set_session_mode(
                session_id=session.session_id, mode_id=BYPASS_MODE
            )
        except RequestError as e:
            logger.warning(
                "setting %s failed (%s); approving permission requests instead",
                BYPASS_MODE,
                e,
            )

    async def _close_session(self, conn: ClientSideConnection, session_id: str) -> None:
        if not self._can_close or conn is not self._conn:
            return  # the agent can't close sessions, or its process is already gone
        try:
            _ = await asyncio.wait_for(
                asyncio.shield(conn.close_session(session_id=session_id)),
                CLOSE_TIMEOUT_S,
            )
        except (RequestError, ConnectionError, TimeoutError) as e:
            logger.warning("closing claude session %s failed: %s", session_id, e)

    async def _cancel_stderr_task(self) -> None:
        if self._stderr_task is not None:
            _ = self._stderr_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._stderr_task
            self._stderr_task = None

    async def _teardown(self) -> None:
        stack, self._stack, self._conn, self._process = self._stack, None, None, None
        await self._cancel_stderr_task()
        if stack is not None:
            await stack.aclose()


@function_tool(flags=ToolFlag.CANCELLABLE)
async def claude(context: RunContext[ClaudeRunner], task: str, session: str) -> str:
    """Send a request to Claude Code, a coding agent with full access to this computer:
    files, shell, git and the web. Use it for any real work on the project. It runs in
    the background and can take minutes; its final report arrives as this tool's result.

    Work is organized in named sessions. Each session is one Claude conversation that
    remembers everything it did in this call. Sessions run in parallel. A request sent to
    a session that is still working reaches it mid-task and returns at once; the running
    task's result covers it.

    Args:
        task: What the user wants, with every detail they gave. Claude cannot hear this
            conversation, but a session remembers its own earlier work.
        session: A short name for the piece of work, like "landing-page". Reuse the name
            for follow-ups and changes to that work; pick a new name for unrelated work.
    """
    name = session_name(session)
    if context.userdata.is_busy(name):
        await context.update(
            f"Sent to Claude session {name}, which is still working: {task}"
        )
    else:
        await context.update(f"Claude session {name} has started on: {task}")
    return await context.userdata.run(task, name)
