"""Whether a harness is set up, checked the same way for every agent: start it, open a
session in an empty folder and look at what comes back, without sending a prompt
(docs/decisions/check-agent-setup-with-an-acp-probe.md). The user's picks (`settings.py`)
are applied first, so it shows the model a call's session would run on, and which picks the
agent no longer offers. For the model picker it also lists what can be picked.

A session lands in the agent's history, so the background check opens one only when the
agent can delete it again, or when the app asks for one (`open_session`): it does once per launch
for an agent that can't (omp), so even that one's setup and model are checked, not assumed.
The model picker, which the user opens, gets one either way. Either is closed afterwards.
Whenever a session was opened, what can be picked comes back too, so the app keeps it for the
model picker instead of starting the agent again when the picker opens (goose reads its
keychain each time it starts, docs/acp-notes.md#goose-keys).

An agent that fails still comes back with the keys it asks for, as far as the probe can tell
without a session: its key fields stay on its row, since a missing key, or macOS asking
for a password for the agent's own keychain item, is often why it failed.
"""

import asyncio
import contextlib
import logging
import re
import tempfile
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Literal

from acp import RequestError
from acp.client.connection import ClientSideConnection
from acp.schema import (
    AgentCapabilities,
    AuthMethodAgent,
    EnvVarAuthMethod,
    InitializeResponse,
    TerminalAuthMethod,
)

from harnesses.harness import Harness, KeyVar
from job import Pick

from .client import HarnessClient, connect
from .environment import launch
from .redaction import scrub, secrets_to_redact
from .sessions import can_delete, discard_session
from .settings import Setting, Skipped, apply, model_name, needs_pick

logger = logging.getLogger("bomby.acp_client.probe")

TIMEOUT_S = 30
# claude-agent-acp gives its own `claude auth status` run 5 s (`dist/auth-status.d.ts`).
AUTH_WAIT_S = 6
FOLDER = Path(tempfile.gettempdir()) / "bomby-probe"
_COMMAND = re.compile(r"`([^`]+)`")
_MAX_DETAIL = 300


type Step = Literal["connect", "sign_in", "pick", "unreachable", "ready"]
"""What the user does next for an agent, the first that applies:
- `connect`: install its ACP adapter, which the app does (`adapter`).
- `unreachable`: try again later; it didn't answer in time, quit while starting, or
  couldn't be started (`problem`).
- `sign_in`: fix the agent's own setup, in the agent (`fix`, in Terminal): it isn't signed
  in, refused to open a session, or has no model set.
- `pick`: pick its model; its harness requires one (`model_selection_required`) and no
  model pick holds.
- `ready`: nothing; a call can use it.
"""


@dataclass(frozen=True)
class KeyField:
    """A key Settings offers to save for an agent, which reaches only that agent, in its
    environment as `name` (docs/decisions/agent-keys-through-the-environment.md)."""

    name: str
    """The environment variable: "OPENROUTER_API_KEY"."""
    label: str
    """What the field is called: "OpenRouter API key"."""
    secret: bool = True
    """A secret, typed in a password field (ACP's `AuthEnvVar.secret`)."""
    optional: bool = False


@dataclass(frozen=True)
class Setup:
    """What Settings shows about an installed agent."""

    step: Step
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
    skipped: tuple[Skipped, ...] = ()
    """Picks that didn't apply (gone or refused); sessions keep its default for them."""
    session: bool = False
    """Whether a session was opened, so `model` and `skipped` are known. The background
    check opens none in an agent that can't delete it (omp)."""
    settings: tuple[Setting, ...] = ()
    """What the user can pick, with the picks applied; whenever a session was opened."""
    keys: tuple[KeyField, ...] = ()
    """The keys Settings offers to save: the agent's ACP `env_var` auth methods', else its
    harness's (`key_vars`), for its provider where they follow one."""
    setup_files: tuple[str, ...] = ()
    """The files that hold its own setup, home folder expanded (`Harness.setup_files`):
    the app remembers a ready check until one of them changes."""
    timed_out: bool = False
    """It didn't answer in time (`unreachable`). For an agent that reads its keys from the
    macOS keychain, the likeliest reason is a password prompt nobody has answered yet."""


async def probe(
    harness: Harness,
    program: Path,
    environ: Mapping[str, str],
    picks: Sequence[Pick] = (),
    listing: bool = False,
    open_session: bool = False,
) -> Setup:
    """Checks `harness`, started from `program` the way a call would start it, with the
    user's `picks` applied in order. `listing` is for the model picker: it opens a session
    even in an agent that can't delete it, to list the settings that can be picked.
    `open_session` opens one there too."""
    # Out of what it says back before that's cut short, so no part of a key is left.
    secrets = secrets_to_redact(environ)
    # What `initialize` answered, if it got that far: its keys show on a failure too.
    started: list[InitializeResponse] = []

    def failed(problem: str, timed_out: bool = False) -> Setup:
        return _unreachable(harness, picks, started, problem, timed_out)

    try:
        adapter = harness.adapter_path(environ)
        if adapter is not None and not Path(adapter).is_file():
            return Setup(
                "connect",
                problem="Its ACP adapter isn't set up",
                adapter=harness.adapter,
            )
        # Inside the `try`: a launch or a folder that fails fails this agent only.
        command, args, env = launch(harness, program, environ)
        client = HarnessClient(harness)
        FOLDER.mkdir(exist_ok=True)
        async with asyncio.timeout(TIMEOUT_S):
            async with connect(client, command, args, env=env, cwd=FOLDER) as (
                conn,
                _,
                init,
            ):
                started.append(init)
                return await _check(
                    harness, conn, client, init, picks, listing, open_session, secrets
                )
    except TimeoutError:
        return failed("It didn't answer in time", timed_out=True)
    # Before OSError, which ConnectionError is a kind of.
    except (RequestError, ConnectionError) as e:
        return failed(f"It quit while starting: {detail(e, secrets)}")
    except OSError as e:
        return failed(f"It couldn't be started: {detail(e, secrets)}")
    # Anything else (an answer the SDK can't read) fails only this agent.
    except Exception as e:
        logger.exception("probing %s failed", harness.id)
        return failed(f"It answered in a way Bomby can't read: {detail(e, secrets)}")


def _unreachable(
    harness: Harness,
    picks: Sequence[Pick],
    started: Sequence[InitializeResponse],
    problem: str,
    timed_out: bool,
) -> Setup:
    """An agent that didn't answer, with the keys it asks for as far as they're known
    without a session: its ACP `env_var` auth methods if `initialize` answered, else its
    harness's for the user's pick. Where they follow a setting only a session knows (goose's
    provider, with no pick), there are none, and the app keeps the ones its row showed."""
    auth = (started[0].auth_methods or []) if started else []
    return Setup(
        "unreachable",
        problem=problem,
        keys=key_fields(harness, auth, (), picks),
        setup_files=tuple(str(Path(f).expanduser()) for f in harness.setup_files),
        timed_out=timed_out,
    )


async def probe_all(
    agents: Mapping[str, tuple[Harness, Path]],
    environ: Mapping[str, str],
    picks: Mapping[str, Sequence[Pick]] | None = None,
    listing: Collection[str] = (),
    sessions: Collection[str] = (),
) -> dict[str, Setup]:
    """Checks every agent at once, each with its own `picks`, opening a session in those in
    `listing` or `sessions` even if they can't delete it."""
    ids = list(agents)
    secrets = secrets_to_redact(environ)
    setups = await asyncio.gather(
        *(
            probe(
                harness,
                program,
                environ,
                (picks or {}).get(id, ()),
                id in listing,
                id in sessions,
            )
            for id, (harness, program) in agents.items()
        )
    )
    # What an agent says can echo a key it was given ("Credential rejected: sk-..."), and
    # the answer goes to the page, which never gets a key back.
    return {id: redact(s, secrets) for id, s in zip(ids, setups, strict=True)}


def redact(setup: Setup, secrets: Collection[str]) -> Setup:
    """`setup` with `secrets` taken out of the free text an agent can echo: its problem,
    account and model. Steps, ids, values, commands and paths are never touched, so a key
    that happens to be a common word can't break them."""
    if not secrets:
        return setup

    def clean(text: str | None) -> str | None:
        return None if text is None else scrub(text, secrets)

    return replace(
        setup,
        problem=clean(setup.problem),
        account=clean(setup.account),
        model=clean(setup.model),
    )


async def _check(
    harness: Harness,
    conn: ClientSideConnection,
    client: HarnessClient,
    init: InitializeResponse,
    picks: Sequence[Pick],
    listing: bool,
    open_session: bool,
    secrets: Collection[str],
) -> Setup:
    fix = setup_command(harness, init.auth_methods or [])
    files = tuple(str(Path(f).expanduser()) for f in harness.setup_files)
    deletable = can_delete(init.agent_capabilities)
    if not deletable and not listing and not open_session:
        await _wait_for_auth(client, init)
        setup = _setup(
            client.auth_status,
            fix,
            lacks_model=False,
            # Without a session the model setting is unknown: any pick counts.
            lacks_pick=harness.model_selection_required and not picks,
        )
        return replace(
            setup,
            keys=key_fields(harness, init.auth_methods or [], (), picks),
            setup_files=files,
        )
    try:
        session = await conn.new_session(cwd=str(FOLDER), mcp_servers=[])
    except RequestError as e:
        # Its keys still show: a missing one may be why it refused.
        return Setup(
            "sign_in",
            problem=detail(e, secrets),
            fix=fix,
            keys=key_fields(harness, init.auth_methods or [], (), picks),
            setup_files=files,
        )
    try:
        applied = await apply(
            conn, session.session_id, harness, session.config_options, picks
        )
        await _wait_for_auth(client, init)
        model = model_name(applied.settings)
        setup = _setup(
            client.auth_status,
            fix,
            # No model among its options, or none at all where its harness needs a pick.
            lacks_model=model is None
            and (bool(session.config_options) or harness.model_selection_required),
            lacks_pick=needs_pick(harness, applied, picks),
        )
        return replace(
            setup,
            session=True,
            model=model,
            skipped=applied.skipped,
            settings=applied.settings,
            keys=key_fields(harness, init.auth_methods or [], applied.settings, picks),
            setup_files=files,
        )
    finally:
        await discard_session(conn, session.session_id, init.agent_capabilities)


async def _wait_for_auth(client: HarnessClient, init: InitializeResponse) -> None:
    """Gives an agent that reports its sign-in time to report it."""
    if _reports_auth(init.agent_capabilities):
        with contextlib.suppress(TimeoutError):
            _ = await asyncio.wait_for(client.auth_reported.wait(), AUTH_WAIT_S)


def _setup(
    auth: Mapping[str, object] | None,
    fix: str | None,
    *,
    lacks_model: bool,
    lacks_pick: bool,
) -> Setup:
    """An agent that started, by the first thing it lacks: a sign-in (by its reported
    `auth`), a model, a model pick."""
    if auth and auth.get("kind") == "none":
        return Setup("sign_in", problem="Not signed in", fix=fix)
    label = auth.get("label") if auth else None
    account = label if isinstance(label, str) else None
    if lacks_model:
        return Setup("sign_in", problem="No model is set", fix=fix, account=account)
    if lacks_pick:
        return Setup("pick", problem="Pick its model", account=account)
    return Setup("ready", account=account)


def _reports_auth(capabilities: AgentCapabilities | None) -> bool:
    meta = capabilities.field_meta if capabilities else None
    return "authStatus" in (meta or {})


def detail(error: BaseException, secrets: Collection[str] = ()) -> str:
    """The agent's own words for `error`, without any of `secrets` (the saved keys, which an
    agent can echo), taken out before the words are cut to length. A JSON-RPC error's
    message is generic ("Internal error"); what the agent said is in its `data`
    (docs/acp-notes.md#setup-signals)."""
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
    text = scrub(text or str(error) or type(error).__name__, secrets)
    text = text.strip().rstrip(".")
    return text if len(text) <= _MAX_DETAIL else text[: _MAX_DETAIL - 3] + "..."


def key_fields(
    harness: Harness,
    auth_methods: Sequence[AuthMethodAgent | EnvVarAuthMethod | TerminalAuthMethod],
    settings: Sequence[Setting],
    picks: Sequence[Pick],
) -> tuple[KeyField, ...]:
    """The keys Settings offers for the agent: the variables its `env_var` auth methods
    name, the protocol first, like `setup_command`; else its harness's `key_vars`, for the
    value of the setting they follow, the user's pick for it before the session's current
    one (a provider refused for lack of the very key the user is about to save)."""
    from_protocol = [
        KeyField(
            name=var.name,
            label=var.label or var.name,
            secret=var.secret is not False,
            optional=bool(var.optional),
        )
        for method in auth_methods
        if isinstance(method, EnvVarAuthMethod)
        for var in method.vars
    ]
    if from_protocol:
        return _unique(from_protocol)
    if harness.key_vars is None:
        return ()
    setting = harness.key_vars.setting
    value = next((p.value for p in reversed(picks) if p.setting == setting), None)
    if value is None or value in harness.key_vars.defaults:
        value = next((s.current for s in settings if s.id == setting), None)
    return _unique(_field(var) for var in harness.key_vars.offered(value))


def _field(var: KeyVar) -> KeyField:
    return KeyField(name=var.name, label=var.label, optional=var.optional)


def _unique(fields: Iterable[KeyField]) -> tuple[KeyField, ...]:
    """`fields` without a second one for the same variable."""
    unique: dict[str, KeyField] = {}
    for field in fields:
        _ = unique.setdefault(field.name, field)
    return tuple(unique.values())


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
