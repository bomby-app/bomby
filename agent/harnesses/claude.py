"""Claude Code, through `claude-agent-acp` (Zed's ACP adapter for the Claude Agent SDK).

The adapter runs the user's own `claude` (handed over in `CLAUDE_CODE_EXECUTABLE`) on
their Claude plan. Facts checked against the adapter are in docs/acp-notes.md.
"""

from .harness import Harness

CLAUDE_CODE = Harness(
    id="claude",
    name="Claude Code",
    short_name="Claude",
    program="claude",
    adapter="claude-agent-acp",
    adapter_env="CLAUDE_ACP_BIN",
    program_env="CLAUDE_CODE_EXECUTABLE",
    # With an API key in its environment Claude Code bills the API account instead of the
    # Claude plan. Claude Code sets CLAUDECODE in its own shells and refuses to start under
    # it, which would break running this agent from a Claude terminal.
    blocked_env=frozenset({"ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDECODE"}),
    # The runner's briefing (prompts/harness-briefing.md and the project's folders) goes
    # into Claude's system prompt.
    system_prompt_append=True,
    bypass_mode="bypassPermissions",
    # The SDK sends it as `_session/steering`.
    steer_method="session/steering",
)
