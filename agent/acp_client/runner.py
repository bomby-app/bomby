"""Runs a call's work on ACP agents (harnesses, defined in `harnesses/`): one adapter
process per harness, named sessions in it.

The voice model names a session per piece of work; sessions run in parallel, and each keeps
its context from request to request. A request to a session that is still working is
steered into its running turn when the harness can steer. The voice model only ever sees
the agent's final message, as the tool result, when a turn ends: a steered request's result
comes then too, so a result always means the work is done.
"""

import asyncio
import contextlib
import logging
import os
from collections.abc import Awaitable, Callable, Mapping, Sequence
from contextlib import AsyncExitStack
from dataclasses import dataclass
from pathlib import Path
from typing import final

from acp import RequestError, text_block
from acp.client.connection import ClientSideConnection
from acp.schema import AgentCapabilities, InitializeResponse, NewSessionResponse
from dotenv import dotenv_values
from livekit.agents.llm import ToolError

from harnesses import HARNESSES, installed
from harnesses.harness import Harness
from job import JobFields, Pick
from project import Project
from sections import join, section

from .client import HarnessClient, Reply, connect
from .sessions import close_session, discard_session
from .settings import Applied, apply, model_setting, needs_pick

logger = logging.getLogger("bomby.acp_client.runner")

AGENT_ROOT = Path(__file__).resolve().parent.parent
# What every harness is told about working behind a voice assistant.
BRIEFING = (AGENT_ROOT / "prompts" / "harness-briefing.md").read_text().rstrip()
# Must match the line in harness-briefing.md (a test checks).
REPORT_RULE = "- stay under about 100 words, unless the task is to find information the user asked for"
SHORT_REPORT_RULE = (
    "- stay under about 100 words, even when the task is to find information: give what"
    + " the user asked for and leave out the rest, which they can ask for next"
)
# Never passed to any harness: the desktop app starts this agent with the user's LiveKit,
# voice provider and Zep keys in its environment (not in .env), and GEMINI_API_KEY may
# come from the user's own shell. Each harness blocks its own on top.
APP_KEYS = frozenset(
    {
        "LIVEKIT_URL",
        "LIVEKIT_API_KEY",
        "LIVEKIT_API_SECRET",
        "GOOGLE_API_KEY",
        "GEMINI_API_KEY",
        "OPENAI_API_KEY",
        "RIME_API_KEY",
        "ZEP_API_KEY",
        # The core's token socket for the hosted MCP extensions (`extensions/tokens.py`).
        "BOMBY_TOKENS",
        "BOMBY_TOKENS_SECRET",
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


def no_report(harness: Harness) -> str:
    return (
        f"{harness.short_name} ended without reporting back, so there's no sign it did "
        "the work. Don't say it's done: tell the user, and offer to try again or to try "
        "another agent."
    )


def no_model_picked(harness: Harness) -> str:
    return (
        f"{harness.short_name} needs its model picked in Settings before it can work. "
        "Tell the user, and offer another agent, if there is one."
    )


def stopped(harness: Harness) -> str:
    return (
        f"{harness.short_name} stopped before finishing. Say sorry and offer to try "
        "again or to try another agent."
    )


def briefing(project: Project, short_reports: bool = False) -> str:
    """What a harness is told once per session: how its result is used, the folders it
    works in (every harness gets them, whether or not it reads ACP's
    `additionalDirectories`) and the user's description of the project, if any."""
    folders = f"You're working in {project.cwd}"
    if project.extra_folders:
        folders += ", and this project also includes " + ", ".join(
            project.extra_folders
        )
    description = (
        join("The user's description of this project:", project.instructions)
        if project.instructions
        else ""
    )
    rules = (
        BRIEFING.replace(REPORT_RULE, SHORT_REPORT_RULE) if short_reports else BRIEFING
    )
    return join(
        rules,
        section("This project", join(f"{project.name}. {folders}.", description)),
    )


def session_name(name: str) -> str:
    """The key a session is known by: lowercase words joined by dashes ("Samba page" is
    "samba-page"), so the voice model can't open a second session by changing case."""
    return "-".join(name.lower().split()) or DEFAULT_SESSION


def steered_note(harness: Harness) -> str:
    """What a request sent mid-turn returns once the turn it joined ends, beside that
    turn's result, which covers it."""
    return (
        f"{harness.short_name} did this as part of the task it was already working on. "
        + "That task's result, which arrives with this, covers it."
    )


@dataclass(frozen=True)
class Turn:
    """What a request to a session came back with."""

    text: str
    """The agent's final message, or `steered_note` when the request was steered."""
    steered: bool = False
    """Whether it joined a turn that was already running, whose result covers it."""


@final
class _RunningTurn:
    """A prompt turn in progress, which the requests steered into it wait on."""

    def __init__(self) -> None:
        self._ended = asyncio.Event()
        self._error: str | None = None

    def end(self, error: str | None = None) -> None:
        """The turn is over; `error` is the voice's line when it didn't finish."""
        self._error = error
        self._ended.set()

    async def wait(self) -> None:
        """Until the turn is over. Raises the turn's `ToolError` when it didn't finish."""
        _ = await self._ended.wait()
        if self._error is not None:
            raise ToolError(self._error)


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
        self.running: _RunningTurn | None = None  # set while the lock is held


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
        picks: Sequence[Pick] = (),
        short_reports: bool = False,
    ) -> None:
        self._harness = harness
        self._short_reports = short_reports
        self._picks = tuple(picks)  # the model and effort the user picked, if any
        self._command = command
        self._args = tuple(args)
        self._project = project
        self._env = dict(env)
        self._client = HarnessClient(harness)
        self._lock = asyncio.Lock()  # the process
        self._stack: AsyncExitStack | None = None
        self._conn: ClientSideConnection | None = None
        self._process: asyncio.subprocess.Process | None = None
        self._capabilities: AgentCapabilities | None = None
        self._can_steer = False
        self._conn_failed = False  # a request saw the connection drop
        self._closed = False  # the call ended: refuse new work
        self._sessions: dict[str, _Session] = {}

    @property
    def command(self) -> str:
        return self._command

    @property
    def env(self) -> Mapping[str, str]:
        return self._env

    @property
    def can_steer(self) -> bool:
        """Whether a request to a busy session joins its running turn instead of waiting.
        Known once the agent has started, which a busy session always has."""
        return self._can_steer

    def is_busy(self, name: str) -> bool:
        """Whether the session called `name` has a turn running."""
        session = self._sessions.get(session_name(name))
        return session is not None and session.running is not None

    async def run(
        self,
        task: str,
        session: str = DEFAULT_SESSION,
        on_start: Callable[[], Awaitable[None]] | None = None,
    ) -> Turn:
        """Send `task` to the session called `session`; return the agent's final message.

        A new name opens a new session. Mid-turn, the task is steered into the running
        turn, and this returns a steered `Turn` when that turn ends: its result answers
        both. Cancelling a steered request stops only the waiting, not the turn. Without
        steering, it waits for the running turn and then takes its own. `on_start` runs once
        the agent takes the task: steered in, or its own turn starting.
        """
        if self._closed:
            raise ToolError(self._ending())
        s = self._sessions.setdefault(
            session_name(session), _Session(session_name(session))
        )
        running = s.running
        if running is not None and self._can_steer:
            conn, session_id = await self._open(s)
            if await self._steer(conn, s, session_id, task):
                if on_start is not None:
                    await on_start()
                await running.wait()
                return Turn(steered_note(self._harness), steered=True)
        async with s.turn_lock:
            # Set before anything awaits, so a request steered in now waits on this turn.
            running = s.running = _RunningTurn()
            try:
                if on_start is not None:
                    await on_start()
                conn, session_id = await self._open(s)
                text, finished = await self._prompt(conn, s, session_id, task)
            except ToolError as e:
                running.end(error=str(e))
                raise
            except BaseException:
                running.end(error=stopped(self._harness))
                raise
            finally:
                s.running = None
            # The original request hears how it stopped; one steered in only that it didn't
            # get done.
            running.end(error=None if finished else stopped(self._harness))
            return Turn(text)

    async def aclose(self) -> None:
        """Close every session, then the adapter process. No new work after this."""
        self._closed = True
        try:
            for s in list(self._sessions.values()):
                async with s.open_lock:
                    session_id, conn, s.id, s.conn = s.id, s.conn, None, None
                    # Closed, not deleted: the call's sessions stay in the agent's history.
                    # One whose process is gone is gone with it.
                    if (
                        session_id is not None
                        and conn is not None
                        and conn is self._conn
                    ):
                        await close_session(conn, session_id, self._capabilities)
        finally:
            # Whatever closing a session did, the process doesn't outlive the call.
            async with self._lock:
                await self._teardown()

    async def _open(self, s: _Session) -> tuple[ClientSideConnection, str]:
        try:
            return await self._open_session(s)
        except ToolError:
            raise
        except Exception as e:
            if self._closed:
                raise ToolError(self._ending()) from e
            if isinstance(e, OSError | RequestError | ConnectionError):
                logger.warning("%s could not start: %r", self._harness.id, e)
            else:
                # Unexpected (an answer the SDK can't read): logged whole.
                logger.exception("%s could not start", self._harness.id)
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
            options: dict[str, object] = {}
            if self._harness.system_prompt_append:
                options["systemPrompt"] = {
                    "append": briefing(self._project, self._short_reports)
                }
            try:
                created = await conn.new_session(
                    cwd=str(self._project.cwd),
                    additional_directories=self._project.extra_folders or None,
                    mcp_servers=[],
                    **options,
                )
                await self._bypass_permissions(conn, created)
                applied = await self._apply_picks(conn, created)
            except ConnectionError:
                self._connection_lost(conn)
                raise
            if needs_pick(self._harness, applied, self._picks):
                logger.warning(
                    "%s needs its model picked; discarding session %s",
                    self._harness.id,
                    created.session_id,
                )
                await discard_session(conn, created.session_id, self._capabilities)
                # With no model to pick at all, its own setup lacks one, as Settings says.
                raise ToolError(
                    no_model_picked(self._harness)
                    if model_setting(applied.settings)
                    else not_ready(self._harness)
                )
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
    ) -> tuple[str, bool]:
        """Runs one turn: the agent's final message, and whether the turn ended normally."""
        name = self._harness.short_name
        reply = self._client.replies[session_id] = Reply()
        logger.info("%s turn in %s started: %s", self._harness.id, s.name, task)
        # Without a system prompt to put it in, the briefing goes with the first task.
        texts = (
            [task]
            if s.briefed
            else [briefing(self._project, self._short_reports), task]
        )
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
        if not reply.text:
            # Some models end a turn with nothing to say; passing that on as a result
            # reads as done (OpenCode on one OpenRouter model, 2026-11-05).
            logger.warning(
                "%s turn in %s ended without a final message", self._harness.id, s.name
            )
            raise ToolError(no_report(self._harness))
        text = reply.text
        finished = response.stop_reason == "end_turn"
        if not finished:
            text = f"{name} stopped early ({response.stop_reason}). Its last message: {text}"
        logger.info("%s turn in %s result: %s", self._harness.id, s.name, text)
        return text, finished

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
                conn, process, init = await stack.enter_async_context(
                    connect(
                        self._client,
                        self._command,
                        self._args,
                        env=self._env,
                        cwd=self._project.cwd,
                    )
                )
            except BaseException:
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
        self._capabilities = init.agent_capabilities
        steering: object = (init.field_meta or {}).get("steering")
        self._can_steer = (
            self._harness.steer_method is not None
            and isinstance(steering, dict)
            and steering.get("supported") is True  # pyright: ignore[reportUnknownMemberType]
        )
        if not self._can_steer:
            logger.warning("%s can't steer: mid-turn requests will wait", self._command)

    async def _apply_picks(
        self, conn: ClientSideConnection, session: NewSessionResponse
    ) -> Applied:
        """Gives the session the model and effort the user picked. One the agent no longer
        offers leaves its default; Settings shows it too (the probe finds the same)."""
        applied = await apply(
            conn,
            session.session_id,
            self._harness,
            session.config_options,
            self._picks,
        )
        for skipped in applied.skipped:
            logger.warning(
                "%s skipped %s %s (%s); the session keeps its default",
                self._harness.id,
                skipped.setting,
                skipped.value,
                skipped.why,
            )
        return applied

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

    async def _teardown(self) -> None:
        stack, self._stack, self._conn, self._process = self._stack, None, None, None
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
        picks: Mapping[str, Sequence[Pick]] | None = None,
        short_reports: bool = False,
    ) -> None:
        self._project = project
        self._short_reports = short_reports
        self._environ = dict(environ)
        self._picks = dict(picks or {})
        self._installed = {
            id: program
            for id, program in installed.items()
            if self._offered(HARNESSES[id])
        }
        self._runners: dict[str, AcpRunner] = {}

    @classmethod
    def for_job(cls, fields: JobFields, short_reports: bool = False) -> "CallRunners":
        """Runners for the project and the installed agents in the job's metadata, with
        each agent's picks (see `Project.from_job` and `harnesses.installed`)."""
        return cls(
            Project.from_job(fields, os.environ),
            installed(fields, HARNESSES, os.environ),
            os.environ,
            fields.picks if fields else {},
            short_reports,
        )

    @property
    def project(self) -> Project:
        return self._project

    def _offered(self, harness: Harness) -> bool:
        """Whether a call can use `harness`: not one that requires a model pick before any
        is made, as on a console run, which has no picks. The app leaves those out itself
        (the probe)."""
        if harness.model_selection_required and not self._picks.get(harness.id):
            logger.warning(
                "%s is left out of the call: its model isn't picked (Settings)",
                harness.id,
            )
            return False
        return True

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
            raise ToolError(not_ready(harness))
        command, args, env = launch(harness, program, self._environ)
        runner = self._runners[harness.id] = AcpRunner(
            harness=harness,
            project=self._project,
            env=env,
            command=command,
            args=args,
            picks=self._picks.get(harness.id, ()),
            short_reports=self._short_reports,
        )
        return runner

    async def aclose(self) -> None:
        # Side by side, and each on its own: one that fails to close doesn't leave the
        # others' processes running, and the call's shutdown time isn't spent in a queue.
        results = await asyncio.gather(
            *(runner.aclose() for runner in self._runners.values()),
            return_exceptions=True,
        )
        for id, result in zip(self._runners, results, strict=True):
            if isinstance(result, BaseException):
                logger.error("closing %s failed", id, exc_info=result)
