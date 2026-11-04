"""Runs a call's work on ACP agents (harnesses, defined in `harnesses/`): one adapter
process per harness, named sessions in it.

The voice model names a session per piece of work; sessions run in parallel, and each keeps
its context from request to request. A request to a session that is still working is
steered into its running turn when the harness can steer. The voice model only ever sees
the agent's final message, as the tool result, when a turn ends.
"""

import asyncio
import contextlib
import logging
import os
from collections.abc import Mapping, Sequence
from contextlib import AsyncExitStack
from pathlib import Path
from typing import final

from acp import PROTOCOL_VERSION, RequestError, spawn_agent_process, text_block
from acp.client.connection import ClientSideConnection
from acp.schema import (
    ClientCapabilities,
    Implementation,
    InitializeResponse,
    NewSessionResponse,
)
from dotenv import dotenv_values
from livekit.agents.llm import ToolError

from harnesses import HARNESSES, installed
from harnesses.harness import Harness
from project import Project

from .client import HarnessClient, Reply

logger = logging.getLogger("bomby.acp_client.runner")

AGENT_ROOT = Path(__file__).resolve().parent.parent
# What every harness is told about working behind a voice assistant.
BRIEFING = (AGENT_ROOT / "prompts" / "harness-briefing.md").read_text().rstrip()
CLIENT_INFO = Implementation(name="bomby", version="0.1.0")
# The SDK's read buffer per line. It reassembles longer lines anyway; this only saves
# round trips on large messages. Matches the SDK's agent side.
STDIO_LIMIT = 50 * 1024 * 1024
CLOSE_TIMEOUT_S = 5
# Never passed to any harness: the desktop app starts this agent with the user's LiveKit
# and Gemini keys in its environment (not in .env). Each harness blocks its own on top.
APP_KEYS = frozenset(
    {
        "LIVEKIT_URL",
        "LIVEKIT_API_KEY",
        "LIVEKIT_API_SECRET",
        "GOOGLE_API_KEY",
        "GEMINI_API_KEY",
    }
)
DEFAULT_SESSION = "main"


def child_environment(
    environ: Mapping[str, str], dotenv_keys: set[str], harness: Harness
) -> dict[str, str]:
    """The environment a harness runs with: the shell's, minus this agent's `.env`
    secrets, the app's keys and whatever the harness must not see."""
    blocked = APP_KEYS | harness.blocked_env
    return {
        k: v for k, v in environ.items() if k not in dotenv_keys and k not in blocked
    }


def launch(
    harness: Harness, program: Path, environ: Mapping[str, str]
) -> tuple[str, tuple[str, ...], dict[str, str]]:
    """How to start `harness` from `program`, with this agent's environment minus its
    secrets."""
    dotenv_keys = set(dotenv_values(AGENT_ROOT / ".env"))
    return harness.launch(
        str(program), child_environment(environ, dotenv_keys, harness), environ
    )


# What the voice model hears when a harness fails; the details go to the log, and
# Settings shows what to fix (the setup probe).
def not_ready(harness: Harness) -> str:
    return (
        f"{harness.short_name} isn't ready right now. Say sorry and offer another "
        "agent, if there is one."
    )


def stopped(harness: Harness) -> str:
    return (
        f"{harness.short_name} stopped before finishing. Say sorry and offer to try "
        "again or to try another agent."
    )


def briefing(project: Project) -> str:
    """What a harness is told once per session: how its result is used, and the folders
    it works in. Every harness gets it, whether or not it reads ACP's
    `additionalDirectories`."""
    folders = f"You're working in {project.cwd}"
    if project.extra_folders:
        folders += ", and this project also includes " + ", ".join(
            project.extra_folders
        )
    return f"{BRIEFING}\n\n## This project\n\n{project.name}. {folders}."


def session_name(name: str) -> str:
    """The key a session is known by: lowercase words joined by dashes ("Samba page" is
    "samba-page"), so the voice model can't open a second session by changing case."""
    return "-".join(name.lower().split()) or DEFAULT_SESSION


def steered_note(harness: Harness) -> str:
    """What a request sent mid-turn returns at once: the running turn's result covers it."""
    return (
        f"{harness.short_name} got this while it was still working, and is folding it "
        + "into the task that is running. That task's result covers it."
    )


@final
class _Session:
    """One named session in the call."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.id: str | None = None
        self.conn: ClientSideConnection | None = None
        self.briefed = False  # the briefing went with a first task
        self.open_lock = asyncio.Lock()  # opening the ACP session
        self.turn_lock = asyncio.Lock()  # held while a prompt turn runs


@final
class AcpRunner:
    """Runs one harness for one call: one adapter process, named sessions in it.

    Every session works on the call's project. A session opens on its first task and
    stays open until the call ends, so a request to the same name continues the same
    conversation. Sessions run in parallel; within one, a single turn runs at a time, and
    a request that arrives mid-turn is steered into it (or waits for it when the harness
    can't steer).
    """

    def __init__(
        self,
        *,
        harness: Harness,
        project: Project,
        env: Mapping[str, str],
        command: str,
        args: Sequence[str] = (),
    ) -> None:
        self._harness = harness
        self._command = command
        self._args = tuple(args)
        self._project = project
        self._env = dict(env)
        self._client = HarnessClient(harness)
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

    @property
    def harness(self) -> Harness:
        return self._harness

    @property
    def command(self) -> str:
        return self._command

    @property
    def env(self) -> Mapping[str, str]:
        return self._env

    @property
    def project(self) -> Project:
        return self._project

    def is_busy(self, name: str) -> bool:
        """Whether the session called `name` has a turn running."""
        session = self._sessions.get(session_name(name))
        return session is not None and session.turn_lock.locked()

    async def run(self, task: str, session: str = DEFAULT_SESSION) -> str:
        """Send `task` to the session called `session`; return the agent's final message.

        A new name opens a new session. Mid-turn, the task is steered into the running
        turn and this returns `steered_note` at once: that turn's result answers it.
        """
        if self._closed:
            raise ToolError(self._ending())
        s = self._sessions.setdefault(
            session_name(session), _Session(session_name(session))
        )
        if s.turn_lock.locked() and self._can_steer:
            conn, session_id = await self._open(s)
            if await self._steer(conn, s, session_id, task):
                return steered_note(self._harness)
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
            if self._closed:
                raise ToolError(self._ending()) from e
            logger.warning("%s could not start: %r", self._harness.id, e)
            raise ToolError(not_ready(self._harness)) from e

    async def _open_session(self, s: _Session) -> tuple[ClientSideConnection, str]:
        async with s.open_lock:
            if self._closed:
                raise ConnectionError("the call ended")
            conn = await self._connection()
            if s.id is not None and s.conn is conn:
                return conn, s.id
            if s.id is not None:
                logger.warning(
                    "%s restarted: session %s continues as a new session, without the "
                    + "earlier context",
                    self._command,
                    s.name,
                )
            options = dict(self._harness.session_options)
            if self._harness.system_prompt_append:
                options["systemPrompt"] = {"append": briefing(self._project)}
            try:
                created = await conn.new_session(
                    cwd=str(self._project.cwd),
                    additional_directories=self._project.extra_folders or None,
                    mcp_servers=[],
                    **options,
                )
                await self._bypass_permissions(conn, created)
            except ConnectionError:
                self._connection_lost(conn)
                raise
            s.id, s.conn = created.session_id, conn
            s.briefed = self._harness.system_prompt_append
            logger.info(
                "%s session %s (%s) opened for project %s in %s",
                self._harness.id,
                s.name,
                created.session_id,
                self._project.name,
                ", ".join(str(f) for f in self._project.folders),
            )
            return conn, created.session_id

    async def _prompt(
        self, conn: ClientSideConnection, s: _Session, session_id: str, task: str
    ) -> str:
        name = self._harness.short_name
        reply = self._client.replies[session_id] = Reply()
        logger.info("%s turn in %s started: %s", self._harness.id, s.name, task)
        # Without a system prompt to put it in, the briefing goes with the first task.
        texts = [task] if s.briefed else [briefing(self._project), task]
        s.briefed = True
        try:
            response = await conn.prompt(
                session_id=session_id, prompt=[text_block(t) for t in texts]
            )
        except asyncio.CancelledError:
            # Stop the turn, keep the session: the next request continues it.
            with contextlib.suppress(Exception):
                await asyncio.shield(conn.cancel(session_id=session_id))
            raise
        except (ConnectionError, RequestError) as e:
            if isinstance(e, ConnectionError):
                self._connection_lost(conn)
            logger.warning("%s turn in %s failed: %r", self._harness.id, s.name, e)
            raise ToolError(stopped(self._harness)) from e
        finally:
            _ = self._client.replies.pop(session_id, None)

        logger.info(
            "%s turn in %s ended: %s", self._harness.id, s.name, response.stop_reason
        )
        text = reply.text or f"{name} finished without a final message."
        if response.stop_reason != "end_turn":
            text = f"{name} stopped early ({response.stop_reason}). Its last message: {text}"
        logger.info("%s turn in %s result: %s", self._harness.id, s.name, text)
        return text

    async def _steer(
        self, conn: ClientSideConnection, s: _Session, session_id: str, task: str
    ) -> bool:
        """Inject `task` into the running turn. False when no turn is running any more."""
        method = self._harness.steer_method
        if method is None:
            return False
        try:
            result = await conn.ext_method(
                method,
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
        logger.info("%s steer into %s: %s: %s", self._harness.id, s.name, outcome, task)
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
                self._stderr_task = asyncio.create_task(
                    self._log_stderr(process.stderr)
                )
                init = await conn.initialize(
                    protocol_version=PROTOCOL_VERSION,
                    client_capabilities=ClientCapabilities(),
                    client_info=CLIENT_INFO,
                )
            except BaseException:
                await self._cancel_stderr_task()
                await stack.aclose()
                raise
            self._stack, self._conn, self._process = stack, conn, process
            self._conn_failed = False
            self._read_capabilities(init)
            logger.info("%s started (pid %s)", self._command, process.pid)
            return conn

    def _ending(self) -> str:
        return f"The call is ending; {self._harness.short_name} takes no new work."

    def _read_capabilities(self, init: InitializeResponse) -> None:
        capabilities = init.agent_capabilities
        sessions = capabilities.session_capabilities if capabilities else None
        self._can_close = sessions is not None and sessions.close is not None
        steering: object = (init.field_meta or {}).get("steering")
        self._can_steer = (
            self._harness.steer_method is not None
            and isinstance(steering, dict)
            and steering.get("supported") is True  # pyright: ignore[reportUnknownMemberType]
        )
        if not self._can_steer:
            logger.warning("%s can't steer: mid-turn requests will wait", self._command)

    async def _bypass_permissions(
        self, conn: ClientSideConnection, session: NewSessionResponse
    ) -> None:
        mode = self._harness.bypass_mode
        if mode is None:
            return
        modes = session.modes
        if modes is None or all(m.id != mode for m in modes.available_modes):
            logger.warning(
                "%s is not offered; approving permission requests instead", mode
            )
            return
        if modes.current_mode_id == mode:
            return
        try:
            _ = await conn.set_session_mode(session_id=session.session_id, mode_id=mode)
        except RequestError as e:
            logger.warning(
                "setting %s failed (%s); approving permission requests instead", mode, e
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
            logger.warning(
                "closing %s session %s failed: %s", self._harness.id, session_id, e
            )

    async def _log_stderr(self, stream: asyncio.StreamReader | None) -> None:
        # The pipe must be drained, or the adapter blocks once it fills.
        if stream is None:
            return
        while line := await stream.readline():
            logger.debug(
                "%s: %s", self._command, line.decode(errors="replace").rstrip()
            )

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


@final
class CallRunners:
    """A call's runners, one per installed harness, each started on first use; all close
    with the call. `start_task` asks for the harness the voice model picked:
    `runners.get(harness)`."""

    def __init__(
        self,
        project: Project,
        installed: Mapping[str, Path],
        environ: Mapping[str, str],
    ) -> None:
        self._project = project
        self._installed = dict(installed)
        self._environ = dict(environ)
        self._runners: dict[str, AcpRunner] = {}

    @classmethod
    def for_job(cls, metadata: str = "") -> "CallRunners":
        """Runners for the project and the installed agents in the job's metadata (see
        `Project.from_job` and `harnesses.installed`)."""
        return cls(
            Project.from_job(metadata, os.environ),
            installed(metadata, HARNESSES, os.environ),
            os.environ,
        )

    @property
    def project(self) -> Project:
        return self._project

    @property
    def available(self) -> list[Harness]:
        """The installed harnesses, in `HARNESSES` order."""
        return [h for id, h in HARNESSES.items() if id in self._installed]

    def get(self, harness: Harness) -> AcpRunner:
        runner = self._runners.get(harness.id)
        if runner is not None:
            return runner
        program = self._installed.get(harness.id)
        if program is None:
            raise ToolError(f"{harness.short_name} isn't installed on this computer.")
        command, args, env = launch(harness, program, self._environ)
        runner = self._runners[harness.id] = AcpRunner(
            harness=harness, project=self._project, env=env, command=command, args=args
        )
        return runner

    async def aclose(self) -> None:
        for runner in self._runners.values():
            await runner.aclose()
