"""What a harness is started with: its command and an environment without this agent's
secrets, plus the keys the user saved for that agent alone. Apart from the runner, so the
setup probe starts harnesses without importing LiveKit."""

import json
import logging
from collections.abc import Mapping
from pathlib import Path

from dotenv import dotenv_values

from harnesses.harness import Harness

logger = logging.getLogger("bomby.acp_client.environment")

AGENT_ROOT = Path(__file__).resolve().parent.parent

# The keys the user saved for each coding agent in Settings, Agents, as JSON by harness id:
# `{"goose": {"OPENROUTER_API_KEY": "..."}}`. The app sets it on the worker and the probe
# (docs/decisions/agent-keys-through-the-environment.md); console runs have none.
AGENT_KEYS_ENV = "BOMBY_AGENT_KEYS"

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
        # The core's socket for the Agents panel's live streams (`streams.py`).
        "BOMBY_STREAMS",
        "BOMBY_STREAMS_SECRET",
        # Every agent's saved keys; each gets only its own (`saved_keys`).
        AGENT_KEYS_ENV,
    }
)


def saved_keys(environ: Mapping[str, str], harness: Harness) -> dict[str, str]:
    """The keys the user saved for `harness`, by variable, from `AGENT_KEYS_ENV`. None
    when there are none or the value can't be read, which is logged without it."""
    raw = environ.get(AGENT_KEYS_ENV)
    if not raw:
        return {}
    try:
        every: object = json.loads(raw)
    except ValueError:
        logger.warning("%s isn't JSON; no agent gets a saved key", AGENT_KEYS_ENV)
        return {}
    own = every.get(harness.id) if isinstance(every, dict) else None  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    if not isinstance(own, dict):
        return {}
    return {
        name: value
        for name, value in own.items()  # pyright: ignore[reportUnknownVariableType]
        if isinstance(name, str) and isinstance(value, str) and name and value
    }


def every_saved_key(environ: Mapping[str, str]) -> set[str]:
    """Every agent's saved key, to take out of anything an agent says back."""
    raw = environ.get(AGENT_KEYS_ENV)
    if not raw:
        return set()
    try:
        every: object = json.loads(raw)
    except ValueError:
        return set()
    if not isinstance(every, dict):
        return set()
    return {
        value
        for own in every.values()  # pyright: ignore[reportUnknownVariableType]
        if isinstance(own, dict)
        for value in own.values()  # pyright: ignore[reportUnknownVariableType]
        if isinstance(value, str) and value
    }


def child_environment(
    environ: Mapping[str, str], dotenv_keys: set[str], harness: Harness
) -> dict[str, str]:
    """The environment a harness runs with: the shell's, minus this agent's `.env`
    secrets, the app's keys and whatever the harness must not see, then the keys the user
    saved for this harness alone, with its `saved_keys_env`. A saved key wins over the
    same name stripped before (`OPENAI_API_KEY` saved for goose), and reaches no other
    agent."""
    blocked = APP_KEYS | harness.blocked_env
    env = {
        k: v for k, v in environ.items() if k not in dotenv_keys and k not in blocked
    }
    own = saved_keys(environ, harness)
    if own:
        env.update(harness.saved_keys_env)
        env.update(own)
    return env


def launch(
    harness: Harness, program: Path, environ: Mapping[str, str]
) -> tuple[str, tuple[str, ...], dict[str, str]]:
    """How to start `harness` from `program`, with this agent's environment minus its
    secrets."""
    dotenv_keys = set(dotenv_values(AGENT_ROOT / ".env"))
    return harness.launch(
        str(program), child_environment(environ, dotenv_keys, harness), environ
    )
