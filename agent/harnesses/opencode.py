"""OpenCode, which speaks ACP itself: `opencode acp` (opencode.ai/docs/acp, checked with
OpenCode 2.1.4). It runs on the user's own OpenCode setup: their providers, models,
`AGENTS.md` rules and permission config. It offers no ACP session modes (its `mode` config
option picks its own agents, build or plan), so there is no bypass mode to set: whatever its
config still asks about, the client approves once. It has no steering, so a request sent
mid-task waits for the running turn.

Its ACP default model isn't the user's: `opencode acp` ignores the model its window last
used and, without `model` in `opencode.json`, picks the newest it can reach (2.2.5,
`packages/core/src/model.ts`, `Model.default`), once a preview model that answered every
turn with nothing. So the user picks its model before a call uses it.
"""

from .harness import Harness

OPENCODE = Harness(
    id="opencode",
    short_name="OpenCode",
    program="opencode",
    args=("acp",),
    model_selection_required=True,
)
