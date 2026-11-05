"""What sets one ACP agent (a harness) apart from another.

Everything else, from spawning the adapter to sessions, steering and results, is the same
for any agent that speaks ACP, and lives in `acp_client/`.
"""

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

# Where the adapters are built: by the app, into its own folder (BOMBY_ADAPTERS), or by
# `just agent install` (agent/adapters/bin) for console runs.
ADAPTERS = Path(
    os.environ.get("BOMBY_ADAPTERS")
    or Path(__file__).resolve().parent.parent / "adapters" / "bin"
)


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
    """Names never passed to the agent, on top of the app's own keys (`acp_client/runner.py`)."""
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
