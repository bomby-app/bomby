"""Whether a harness is set up, checked the same way for every agent: start it, open a
session in an empty folder and look at what comes back, without sending a prompt
(docs/decisions/check-agent-setup-with-an-acp-probe.md). The user's picks (`settings.py`)
are applied first, so it shows the model a call's session would run on, and which picks the
agent no longer offers. For the model picker it also lists what can be picked.

A session lands in the agent's history, so the background check opens one only when the
agent can delete it again. The model picker, which the user opens, gets one either way,
closed afterwards: an agent like omp offers no models without a session.
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
from .settings import Applied, Choice, Setting, apply, model_name

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
    """The model a new session uses, picks applied, by its display name."""
    adapter: str | None = None
    """The ACP adapter it needs and doesn't have yet, which the app installs: "codex-acp"."""
    gone: tuple[Choice, ...] = ()
    """Picks the agent no longer offers; sessions keep its default for them."""
    needs_pick: bool = False
    """Its harness requires a model pick (`model_selection_required`) and none holds."""
    settings: tuple[Setting, ...] = ()
    """What the user can pick, with the picks applied; only when listing."""


async def probe(
    harness: Harness,
    program: Path,
    environ: Mapping[str, str],
    choices: Sequence[Choice] = (),
    listing: bool = False,
) -> Setup:
    """Checks `harness`, started from `program` the way a call would start it, with the
    user's `choices` applied in order. `listing` is for the model picker: it returns the
    settings that can be picked, opening a session even in an agent that can't delete it."""
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
                return await _check(harness, conn, client, init, choices, listing)
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
    listing: Collection[str] = (),
) -> dict[str, Setup]:
    """Checks every agent at once, each with its own `choices`, listing the settings of
    those in `listing`."""
    ids = list(agents)
    setups = await asyncio.gather(
        *(
            probe(harness, program, environ, (choices or {}).get(id, ()), id in listing)
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
    listing: bool,
) -> Setup:
    fix = setup_command(harness, init.auth_methods or [])
    deletable = _can_delete(init.agent_capabilities)
    if not deletable and not listing:
        await _wait_for_auth(client, init)
        # Without a session there's no telling which setting is the model: any pick counts.
        needs_pick = harness.model_selection_required and not choices
        return _judge(client.auth_status, fix, needs_pick=needs_pick)
    try:
        session = await conn.new_session(cwd=str(FOLDER), mcp_servers=[])
    except RequestError as e:
        return Setup(ready=False, problem=detail(e), fix=fix)
    try:
        applied = await apply(
            conn, session.session_id, harness, session.config_options, choices
        )
        await _wait_for_auth(client, init)
        # An agent that lists config options but no model has none set up yet.
        lacks_model = (
            bool(session.config_options) and model_name(applied.settings) is None
        )
        needs_pick = harness.model_selection_required and not _model_picked(
            applied, choices
        )
        return _judge(
            client.auth_status, fix, applied, lacks_model, needs_pick, listing
        )
    except RequestError as e:
        return Setup(ready=False, problem=detail(e), fix=fix)
    finally:
        if deletable:
            await _delete(conn, session.session_id)
        else:
            await _close(conn, session.session_id, init.agent_capabilities)


async def _wait_for_auth(client: HarnessClient, init: InitializeResponse) -> None:
    """Gives an agent that reports its sign-in time to report it."""
    if _reports_auth(init.agent_capabilities):
        with contextlib.suppress(TimeoutError):
            _ = await asyncio.wait_for(client.auth_reported.wait(), AUTH_WAIT_S)


def _judge(
    auth: Mapping[str, object] | None,
    fix: str | None,
    applied: Applied | None = None,
    lacks_model: bool = False,
    needs_pick: bool = False,
    listing: bool = False,
) -> Setup:
    """The setup, from the sign-in the agent reported and, with a session (`applied`), the
    settings it runs on."""
    label = auth.get("label") if auth else None
    account = label if isinstance(label, str) else None
    if auth and auth.get("kind") == "none":
        return Setup(ready=False, problem="Not signed in", fix=fix)
    if applied is None:
        if needs_pick:
            return Setup(
                ready=False, problem="Pick its model", account=account, needs_pick=True
            )
        return Setup(ready=True, account=account)
    settings = applied.settings if listing else ()
    if lacks_model:
        return Setup(
            ready=False,
            problem="No model is set",
            fix=fix,
            account=account,
            settings=settings,
        )
    if needs_pick:
        return Setup(
            ready=False,
            problem="Pick its model",
            account=account,
            model=model_name(applied.settings),
            gone=applied.gone,
            needs_pick=True,
            settings=settings,
        )
    return Setup(
        ready=True,
        account=account,
        model=model_name(applied.settings),
        gone=applied.gone,
        settings=settings,
    )


def _model_picked(applied: Applied, choices: Sequence[Choice]) -> bool:
    """Whether one of `choices` set the session's model and still holds."""
    model = next((s for s in applied.settings if s.category == "model"), None)
    return model is not None and any(
        c.setting == model.id and c not in applied.gone for c in choices
    )


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
