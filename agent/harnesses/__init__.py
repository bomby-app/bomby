"""The agents Bomby can hand work to, one definition per file (`claude.py`, `opencode.py`,
`omp.py`, `goose.py`), all of the `Harness` type (`harness.py`). Which ones are installed comes with
each call (`installed.py`). Talking ACP to them is `acp_client/`'s job; the voice model
reaches them through one tool, `start_task` (`tools/start_task.py`).

To add one: write its definition next to these, list it in `HARNESSES`, add its id to
`AgentName`, and give the app a row for finding it (`app/src-tauri/src/agents.rs`).
"""

from typing import Literal

from .claude import CLAUDE_CODE
from .goose import GOOSE
from .harness import Harness
from .installed import installed
from .omp import OMP
from .opencode import OPENCODE

HARNESSES: dict[str, Harness] = {h.id: h for h in (CLAUDE_CODE, OPENCODE, OMP, GOOSE)}

# The `agent` choices `start_task` offers the voice model. A literal, so the tool's schema
# is fixed before the session starts (Gemini Live gets its tools once, at connect time).
# tests/test_tools.py checks it matches `HARNESSES`.
AgentName = Literal["claude", "opencode", "omp", "goose"]

# The agent the voice model uses unless the user names another, when it's installed.
DEFAULT_AGENT = CLAUDE_CODE.id

__all__ = [
    "CLAUDE_CODE",
    "DEFAULT_AGENT",
    "GOOSE",
    "HARNESSES",
    "OMP",
    "OPENCODE",
    "AgentName",
    "Harness",
    "installed",
]
