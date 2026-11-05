"""Whether a harness is set up, checked the same way for every agent: start it, open a
session in an empty folder and look at what comes back, without sending a prompt
(docs/decisions/check-agent-setup-with-an-acp-probe.md). It also reads the settings the
setup flow offers (`settings.py`) and checks the user's saved choices still hold.

A session lands in the agent's history, so the background check opens one only when the
agent can delete it again. The setup flow, which the user starts, opens one either way and
closes it, since it can't offer a model without one.
"""

import asyncio
import contextlib
import logging
import re
import tempfile
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from acp import RequestError
from acp.client.connection import ClientSideConnection
from acp.schema import (
    AgentCapabilities,
    AuthMethodAgent,
    EnvVarAuthMethod,
    InitializeResponse,
    TerminalAuthMethod,
)

from harnesses.harness import Harness

from .client import HarnessClient, connect
from .runner import launch
from .settings import Choice, ChoiceGone, Setting, apply, model_name

logger = logging.getLogger("bomby.acp_client.probe")

TIMEOUT_S = 30
# claude-agent-acp gives its own `claude auth status` run 5 s (`dist/auth-status.d.ts`).
AUTH_WAIT_S = 6
FOLDER = Path(tempfile.gettempdir()) / "bomby-probe"
_COMMAND = re.compile(r"`([^`]+)`")
_MAX_DETAIL = 300


@dataclass(frozen=True)
class Setup:
    """What Settings shows about an installed agent."""

    ready: bool
    problem: str | None = None
    """What's wrong, in the agent's words where it gave any."""
    fix: str | None = None
    """What the user runs in Terminal to fix it."""
    account: str | None = None
    """Who it runs as, as the agent labels it: "Claude Max"."""
    model: str | None = None
    """The model a new session uses, by its display name."""
    adapter: str | None = None
    """The ACP adapter it needs and doesn't have yet, which the app installs: "codex-acp"."""
    settings: tuple[Setting, ...] = ()
    """What the setup flow offers, with the choices applied; empty without a session."""


async def probe(
    harness: Harness,
    program: Path,
    environ: Mapping[str, str],
    choices: Sequence[Choice] = (),
    setting_up: bool = False,
) -> Setup:
    """Checks `harness`, started from `program` the way a call would start it, with
    `choices` applied in order. `setting_up` opens a session even in an agent that can't
    delete it, for the setup flow."""
    adapter = harness.adapter_path(environ)
    if adapter is not None and not Path(adapter).is_file():
        return Setup(
            ready=False, problem="Its ACP adapter isn't set up", adapter=harness.adapter
        )
    command, args, env = launch(harness, program, environ)
    client = HarnessClient(harness)
    FOLDER.mkdir(exist_ok=True)
    try:
        async with asyncio.timeout(TIMEOUT_S):
            async with connect(client, command, args, env=env, cwd=FOLDER) as (
                conn,
                _,
                init,
            ):
                return await _check(harness, conn, client, init, choices, setting_up)
    except TimeoutError:
        return Setup(ready=False, problem="It didn't answer in time")
    # Before OSError, which ConnectionError is a kind of.
    except (RequestError, ConnectionError) as e:
        return Setup(ready=False, problem=f"It quit while starting: {detail(e)}")
    except OSError as e:
        return Setup(ready=False, problem=f"It couldn't be started: {detail(e)}")


async def probe_all(
    agents: Mapping[str, tuple[Harness, Path]],
    environ: Mapping[str, str],
    choices: Mapping[str, Sequence[Choice]] | None = None,
    setting_up: Collection[str] = (),
) -> dict[str, Setup]:
    """Checks every agent at once, each with its own saved `choices`."""
    ids = list(agents)
    setups = await asyncio.gather(
        *(
            probe(
                harness,
                program,
                environ,
                (choices or {}).get(id, ()),
                id in setting_up,
            )
            for id, (harness, program) in agents.items()
        )
    )
    return dict(zip(ids, setups, strict=True))


async def _check(
    harness: Harness,
    conn: ClientSideConnection,
    client: HarnessClient,
    init: InitializeResponse,
    choices: Sequence[Choice],
    setting_up: bool,
) -> Setup:
    fix = setup_command(harness, init.auth_methods or [])
    deletable = _can_delete(init.agent_capabilities)
    if not deletable and not setting_up:
        return await _judge_sign_in(client, init, fix, None)
    try:
        session = await conn.new_session(cwd=str(FOLDER), mcp_servers=[])
    except RequestError as e:
        return Setup(ready=False, problem=detail(e), fix=fix)
    try:
        try:
            settings = await apply(
                conn, session.session_id, harness, session.config_options, choices
            )
        except ChoiceGone as e:
            return Setup(ready=False, problem=str(e), settings=e.settings)
        except RequestError as e:
            return Setup(ready=False, problem=detail(e), fix=fix)
        listed = bool(session.config_options)
        return await _judge_sign_in(client, init, fix, (listed, settings))
    finally:
        if deletable:
            await _delete(conn, session.session_id)
        else:
            await _close(conn, session.session_id, init.agent_capabilities)


async def _judge_sign_in(
    client: HarnessClient,
    init: InitializeResponse,
    fix: str | None,
    session: tuple[bool, list[Setting]] | None,
) -> Setup:
    """Judges the setup by the sign-in the agent reports and, with a session (whether it
    listed any config options, and its settings), by its model."""
    if _reports_auth(init.agent_capabilities):
        with contextlib.suppress(TimeoutError):
            _ = await asyncio.wait_for(client.auth_reported.wait(), AUTH_WAIT_S)
    auth = client.auth_status
    account = auth.get("label") if auth else None
    account = account if isinstance(account, str) else None
    if auth and auth.get("kind") == "none":
        return Setup(ready=False, problem="Not signed in", fix=fix)
    if session is None:
        return Setup(ready=True, account=account)
    listed, settings = session
    model = model_name(settings)
    if listed and model is None:
        return Setup(
            ready=False,
            problem="No model is set",
            fix=fix,
            account=account,
            settings=tuple(settings),
        )
    return Setup(ready=True, account=account, model=model, settings=tuple(settings))


def _reports_auth(capabilities: AgentCapabilities | None) -> bool:
    meta = capabilities.field_meta if capabilities else None
    return "authStatus" in (meta or {})


def _can_delete(capabilities: AgentCapabilities | None) -> bool:
    sessions = capabilities.session_capabilities if capabilities else None
    return sessions is not None and sessions.delete is not None


async def _close(
    conn: ClientSideConnection, session_id: str, capabilities: AgentCapabilities | None
) -> None:
    """Closes a session the agent can't delete; it stays in the agent's history."""
    sessions = capabilities.session_capabilities if capabilities else None
    if sessions is None or sessions.close is None:
        return
    try:
        _ = await conn.close_session(session_id=session_id)
    except (RequestError, ConnectionError) as e:
        logger.warning("closing probe session %s failed: %s", session_id, e)


async def _delete(conn: ClientSideConnection, session_id: str) -> None:
    try:
        # SDK 0.12.1 has the schema but no method for it (docs/acp-notes.md).
        _ = await conn._conn.send_request(  # pyright: ignore[reportPrivateUsage]
            "session/delete", {"sessionId": session_id}
        )
    except (RequestError, ConnectionError) as e:
        logger.warning("deleting probe session %s failed: %s", session_id, e)


def detail(error: BaseException) -> str:
    """The agent's own words for `error`. A JSON-RPC error's message is generic ("Internal
    error"); what the agent said is in its `data` (docs/acp-notes.md#setup-signals)."""
    text = ""
    if isinstance(error, RequestError):
        data: object = error.data
        if isinstance(data, dict):
            fields: dict[str, object] = data  # pyright: ignore[reportUnknownVariableType]
            data = next(
                (fields[k] for k in ("details", "message", "error") if k in fields),
                None,
            )
        if isinstance(data, str):
            text = data
    elif isinstance(error, OSError):
        text = error.strerror or ""
    text = (text or str(error) or type(error).__name__).strip().rstrip(".")
    return text if len(text) <= _MAX_DETAIL else text[: _MAX_DETAIL - 3] + "..."


def setup_command(
    harness: Harness,
    auth_methods: Sequence[AuthMethodAgent | EnvVarAuthMethod | TerminalAuthMethod],
) -> str | None:
    """What the user runs in Terminal to set the agent up: the harness's own, or the first
    command an auth method names ("Run `goose configure` to set up ...")."""
    if harness.setup_command:
        return harness.setup_command
    for method in auth_methods:
        found = _COMMAND.search(method.description or "")
        if found:
            return found.group(1)
    return None
