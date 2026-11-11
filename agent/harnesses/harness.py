"""What sets one ACP agent (a harness) apart from another.

Everything else, from spawning the adapter to sessions, steering and results, is the same
for any agent that speaks ACP, and lives in `acp_client/`.
"""

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import cast

import yaml

# Where the adapters are built: by the app, into its own folder (BOMBY_ADAPTERS), or by
# `just agent install` (agent/adapters/bin) for console runs.
ADAPTERS = Path(
    os.environ.get("BOMBY_ADAPTERS")
    or Path(__file__).resolve().parent.parent / "adapters" / "bin"
)


@dataclass(frozen=True)
class KeyVar:
    """An environment variable that holds one of an agent's keys, as ACP's `env_var` auth
    method names one (`AuthEnvVar`)."""

    name: str
    """The variable: "OPENROUTER_API_KEY"."""
    label: str
    """What Settings calls it: "OpenRouter API key"."""
    optional: bool = False


@dataclass(frozen=True)
class SettingSource:
    """Where an agent keeps a session setting's value outside a session, read the way the
    agent reads it: the first of `env` that's set, else the first of `keys` found at the top
    of its YAML `files` (`~` for the home folder), a later file winning over an earlier one.
    Only a text value counts. The probe reads it when no session answers (`KeyVars.saved_in`),
    so a check that times out can still name the keys that follow the setting."""

    env: tuple[str, ...] = ()
    files: tuple[str, ...] = ()
    keys: tuple[str, ...] = ()

    def read(self, environ: Mapping[str, str]) -> str | None:
        """The value, if the agent has one set in `environ` (the environment it's started
        with) or its files. A file that can't be read or parsed counts as empty, as the
        agent skips it too."""
        for name in self.env:
            if value := environ.get(name):
                return value
        merged: dict[object, object] = {}
        for file in self.files:
            merged.update(_yaml_mapping(Path(file).expanduser()))
        for key in self.keys:
            value = merged.get(key)
            if isinstance(value, str) and value:
                return value
        return None


def _yaml_mapping(path: Path) -> dict[object, object]:
    """The top-level mapping of the YAML file at `path`; empty when there's none."""
    try:
        loaded: object = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, yaml.YAMLError):
        return {}
    return cast("dict[object, object]", loaded) if isinstance(loaded, dict) else {}


@dataclass(frozen=True)
class KeyVars:
    """The variables an agent reads its keys from, for one that advertises no ACP `env_var`
    auth method (goose). Settings offers them, and the user's saved values reach only this
    agent, in its environment (`acp_client/environment.py`)."""

    by_value: Mapping[str, tuple[KeyVar, ...]]
    """The variables for each value of `setting`, or under "" when there's no `setting`."""
    setting: str | None = None
    """The session setting whose value decides them (goose's "provider"): the user's pick
    for it, else the session's current value."""
    defaults: frozenset[str] = frozenset()
    """Values of `setting` that mean "the agent's own default" (goose's "goose"): a pick of
    one is decided by the session's current value instead."""
    saved_in: SettingSource | None = None
    """Where the agent keeps `setting` outside a session (goose's provider, in its
    config.yaml): what decides the variables when no session answers and the user picked
    no value, as on a first check that times out."""

    def offered(self, value: str | None) -> tuple[KeyVar, ...]:
        """The variables for `setting`'s `value` (any, without a `setting`)."""
        if self.setting is None:
            return self.by_value.get("", ())
        return self.by_value.get(value, ()) if value is not None else ()


@dataclass(frozen=True)
class Harness:
    """An agent reached over ACP, and how to run it."""

    id: str
    """The name the voice model passes to `start_task` as `agent`, and the key in logs and
    settings: "claude". Short, lowercase, stable."""
    short_name: str
    """How the voice talks about it: "Claude" ("Claude's on it"). Also in tool errors."""
    program: str
    """The agent's own program, which the app finds on the user's computer ("claude"). In
    console runs it's looked up on PATH."""
    args: tuple[str, ...] = ()
    """Arguments that start ACP over stdio, for an agent that speaks it natively: ("acp",)."""
    adapter: str | None = None
    """An ACP adapter to start instead of the program, for an agent that doesn't speak ACP
    itself: its name in `ADAPTERS` ("claude-agent-acp"). The program's path is handed to it
    in `program_env`."""
    adapter_env: str | None = None
    """An environment variable that points at another adapter binary."""
    program_env: str | None = None
    """Where the adapter reads the agent's program path from ("CLAUDE_CODE_EXECUTABLE")."""
    blocked_env: frozenset[str] = frozenset()
    """Names never passed to the agent, on top of the app's own keys (`acp_client/environment.py`)."""
    system_prompt_append: bool = False
    """Whether it takes extra system-prompt text in `session/new` as `systemPrompt.append`
    (claude-agent-acp's option). The runner's briefing goes there; otherwise it goes with
    each session's first task."""
    bypass_mode: str | None = None
    """The session mode that skips permission prompts, if the adapter has one."""
    setup_command: str | None = None
    """What the user runs in Terminal to sign in or set the agent up, when none of its ACP
    `authMethods` names a command ("claude auth login")."""
    steer_method: str | None = None
    """The extension method that adds a message to a running turn, if the adapter has one.
    Used only when `initialize` advertises it in `_meta.steering.supported`."""
    model_selection_required: bool = False
    """Whether the user must pick its model before a call uses it: for an agent whose ACP
    default isn't the user's own choice (OpenCode's). Others run on their defaults until
    the user picks one."""
    pickable_settings: frozenset[str] = frozenset()
    """Session settings the user can pick beyond the model and effort categories, by config
    option id, for one the agent lists without a category (goose's "provider")."""
    key_vars: KeyVars | None = None
    """The variables Settings offers for the agent's keys when its ACP `initialize`
    advertises no `env_var` auth method; the protocol's come first, like `setup_command`
    (docs/decisions/agent-keys-through-the-environment.md)."""
    saved_keys_env: Mapping[str, str] = field(default_factory=dict[str, str])
    """More environment for the agent whenever the user saved a key for it: what makes it
    read its keys from the environment alone (goose's `GOOSE_DISABLE_KEYRING`), so it
    never reads its own keychain item, which macOS asks the user about."""
    setup_files: tuple[str, ...] = ()
    """The files that hold the agent's own setup (its provider, model, sign-in), `~` for
    the home folder. Declaring them lets the app remember a launch check that found the
    agent ready until one of them changes, instead of starting the agent at every launch
    (docs/decisions/remember-the-launch-check.md). An agent that declares none is checked
    at every launch."""

    def adapter_path(self, settings: Mapping[str, str]) -> str | None:
        """The adapter to start, if this agent needs one: an override like
        `CLAUDE_ACP_BIN` from `settings`, or its build in `ADAPTERS`."""
        if self.adapter is None:
            return None
        override = settings.get(self.adapter_env) if self.adapter_env else None
        return override or str(ADAPTERS / self.adapter)

    def launch(
        self, program: str, child_env: Mapping[str, str], settings: Mapping[str, str]
    ) -> tuple[str, tuple[str, ...], dict[str, str]]:
        """The command, arguments and environment that start this agent over ACP, given
        where its program is, the environment it may see (`child_env`, secrets removed)
        and the agent's own settings (`settings`: the full environment, `agent/.env`
        included), where an adapter override like `CLAUDE_ACP_BIN` lives."""
        env = dict(child_env)
        adapter = self.adapter_path(settings)
        if adapter is None:
            return program, self.args, env
        if self.program_env is not None:
            env[self.program_env] = program
        return adapter, self.args, env
