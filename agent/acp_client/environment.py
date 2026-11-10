"""What a harness is started with: its command and an environment without this agent's
secrets. Apart from the runner, so the setup probe starts harnesses without importing
LiveKit."""

from collections.abc import Mapping
from pathlib import Path

from dotenv import dotenv_values

from harnesses.harness import Harness

AGENT_ROOT = Path(__file__).resolve().parent.parent

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
