"""`agent/.env`, for runs from source (`just agent console`, `just app dev`) only.

The packaged agent never reads one: the app gives it the keys in its environment. Frozen,
python-dotenv would look for `.env` from the current folder up through every parent, so a
stray `~/.env` could change the agent (python-dotenv 1.2.4, `find_dotenv`).
"""

import sys

from dotenv import load_dotenv


def load() -> None:
    """Loads `agent/.env` into the environment, unless this is the packaged agent."""
    if not getattr(sys, "frozen", False):
        _ = load_dotenv()
