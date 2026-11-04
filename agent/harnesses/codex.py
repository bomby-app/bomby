"""Codex CLI, through `codex-acp` (the ACP project's adapter; Codex has no ACP mode of its
own, codex-cli 0.164.0). The adapter runs the user's own `codex` (handed over in
`CODEX_PATH`) on their own login and config. Facts checked against adapter 2.2.2 are in
docs/acp-notes.md.
"""

from .harness import Harness

CODEX = Harness(
    id="codex",
    name="Codex",
    short_name="Codex",
    program="codex",
    adapter="codex-acp",
    adapter_env="CODEX_ACP_BIN",
    program_env="CODEX_PATH",
    # No approvals and no sandbox ("never", `danger-full-access`), like Claude's bypass.
    bypass_mode="agent-full-access",
    # Its auth methods name no command.
    setup_command="codex login",
    # The SDK sends it as `_session/steering`.
    steer_method="session/steering",
)
