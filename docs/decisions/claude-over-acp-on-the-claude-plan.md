# Claude Code over ACP, billed on the Claude plan

Status: Accepted, 2026-11-03

## Context

We need full Claude Code (shell, files, git, web, the user's settings and hooks), driven from Python, with streaming and cancel. Claude Code speaks ACP through the `@agentclientprotocol/claude-agent-acp` adapter; the Python SDK `agent-client-protocol` is the client side.

## Decision

Run `claude-agent-acp` as a child process (pinned in `mise.toml`) and drive it over ACP v1 from `ClaudeRunner`. Pass Claude the shell environment minus the agent's `.env` keys, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDECODE`, so it signs in with the user's Claude plan login rather than billing an API key.

## Consequences

- The adapter is an npm tool the machine must have (`just tools`).
- Claude loads the user's global `CLAUDE.md`, hooks and settings. That is the point (full Claude), but hooks run for every task.
- Stay on ACP v1: the adapter's v2 is a draft and the Python SDK speaks v1.
