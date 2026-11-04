# Claude's output reaches the voice model only as the tool result

Status: Accepted, 2026-11-03

## Context

Pushing Claude's progress into the conversation (`session.generate_reply`, mid-run updates) makes the voice model talk over the user and narrate noise.

## Decision

The `claude` tool's first `ctx.update()` tells Gemini a task is running. Claude's final message, and nothing else, comes back as the tool's return value when the turn ends. Text before a tool call or under an earlier message id is narration and is dropped.

## Consequences

- The user hears about progress only if they ask, or once the planned status events (roadmap step 2) show it in the app.
- Claude's appended system prompt (`agent/prompts/claude-system-prompt.md`) shapes the final message for speech.
