"""Whether a harness is set up, checked the same way for every agent: start it, open a
session in an empty folder and look at what comes back, without sending a prompt
(docs/decisions/check-agent-setup-with-an-acp-probe.md).
"""

import asyncio
import contextlib
import logging
import re
import tempfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from acp import PROTOCOL_VERSION, RequestError, spawn_agent_process
from acp.client.connection import ClientSideConnection
from acp.schema import (
    AgentCapabilities,
    AuthMethodAgent,
    ClientCapabilities,
    EnvVarAuthMethod,
    InitializeResponse,
    NewSessionResponse,
    SessionConfigOptionSelect,
    SessionConfigSelectGroup,
    TerminalAuthMethod,
)

from harnesses.harness import Harness

from .client import HarnessClient
from .runner import CLIENT_INFO, STDIO_LIMIT, launch

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


async def probe(harness: Harness, program: Path, environ: Mapping[str, str]) -> Setup:
    """Checks `harness`, started from `program` the way a call would start it."""
    command, args, env = launch(harness, program, environ)
    client = HarnessClient(harness)
    FOLDER.mkdir(exist_ok=True)
    try:
        async with asyncio.timeout(TIMEOUT_S):
            async with spawn_agent_process(
                client,
                command,
                *args,
                env=env,
                cwd=FOLDER,
                transport_kwargs={"limit": STDIO_LIMIT},
            ) as (conn, process):
                drain = asyncio.create_task(_drain(process.stderr))
                try:
                    return await _check(harness, conn, client)
                finally:
                    _ = drain.cancel()
    except TimeoutError:
        return Setup(ready=False, problem="It didn't answer in time")
    except OSError as e:
        return Setup(ready=False, problem=f"It couldn't be started: {detail(e)}")
    except (RequestError, ConnectionError) as e:
        return Setup(ready=False, problem=f"It quit while starting: {detail(e)}")


async def probe_all(
    agents: Mapping[str, tuple[Harness, Path]], environ: Mapping[str, str]
) -> dict[str, Setup]:
    """Checks every agent at once."""
    ids = list(agents)
    setups = await asyncio.gather(
        *(probe(harness, program, environ) for harness, program in agents.values())
    )
    return dict(zip(ids, setups, strict=True))


async def _check(
    harness: Harness, conn: ClientSideConnection, client: HarnessClient
) -> Setup:
    init = await conn.initialize(
        protocol_version=PROTOCOL_VERSION,
        client_capabilities=ClientCapabilities(),
        client_info=CLIENT_INFO,
    )
    fix = setup_command(harness, init.auth_methods or [])
    try:
        session = await conn.new_session(cwd=str(FOLDER), mcp_servers=[])
    except RequestError as e:
        return Setup(ready=False, problem=detail(e), fix=fix)
    try:
        if _reports_auth(init.agent_capabilities):
            with contextlib.suppress(TimeoutError):
                _ = await asyncio.wait_for(client.auth_reported.wait(), AUTH_WAIT_S)
        return _judge(session, client.auth_status, fix)
    finally:
        await _discard(conn, init, session.session_id)


def _judge(
    session: NewSessionResponse, auth: Mapping[str, object] | None, fix: str | None
) -> Setup:
    account = auth.get("label") if auth else None
    account = account if isinstance(account, str) else None
    if auth and auth.get("kind") == "none":
        return Setup(ready=False, problem="Not signed in", fix=fix)
    options = session.config_options
    model = next(
        (
            o
            for o in options or []
            if isinstance(o, SessionConfigOptionSelect) and o.category == "model"
        ),
        None,
    )
    if options and model is None:
        return Setup(ready=False, problem="No model is set", fix=fix, account=account)
    return Setup(
        ready=True, account=account, model=_display_name(model) if model else None
    )


def _display_name(option: SessionConfigOptionSelect) -> str:
    choices = [
        choice
        for entry in option.options
        for choice in (
            entry.options if isinstance(entry, SessionConfigSelectGroup) else [entry]
        )
    ]
    return next(
        (c.name for c in choices if c.value == option.current_value),
        option.current_value,
    )


def _reports_auth(capabilities: AgentCapabilities | None) -> bool:
    meta = capabilities.field_meta if capabilities else None
    return bool(meta) and "authStatus" in (meta or {})


async def _discard(
    conn: ClientSideConnection, init: InitializeResponse, session_id: str
) -> None:
    """Removes the probe's session from the agent's history, or at least closes it."""
    capabilities = init.agent_capabilities
    sessions = capabilities.session_capabilities if capabilities else None
    try:
        if sessions and sessions.delete is not None:
            # SDK 0.12.1 has the schema but no method for it (docs/acp-notes.md).
            _ = await conn._conn.send_request(  # pyright: ignore[reportPrivateUsage]
                "session/delete", {"sessionId": session_id}
            )
        elif sessions and sessions.close is not None:
            _ = await conn.close_session(session_id=session_id)
    except (RequestError, ConnectionError) as e:
        logger.warning("discarding probe session %s failed: %s", session_id, e)


async def _drain(stream: asyncio.StreamReader | None) -> None:
    while stream is not None and await stream.readline():
        pass


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
