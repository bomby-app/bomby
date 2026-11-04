"""OpenCode, which speaks ACP itself: `opencode acp` (opencode.ai/docs/acp, checked with
OpenCode 2.1.4). It runs on the user's own OpenCode setup: their providers, models,
`AGENTS.md` rules and permission config. It offers no ACP session modes (its `mode` config
option picks its own agents, build or plan), so there is no bypass mode to set: whatever its
config still asks about, the client approves once. It has no steering, so a request sent
mid-task waits for the running turn.
"""

from .harness import Harness

OPENCODE = Harness(
    id="opencode",
    name="OpenCode",
    short_name="OpenCode",
    program="opencode",
    args=("acp",),
)
