# Agent output reaches the voice model only as the tool result

Status: Accepted, 2026-11-03

## Context

Pushing agent progress into the conversation (`session.generate_reply`, mid-run updates) makes the voice model talk over the user and narrate noise.

## Decision

`start_task`'s first `ctx.update()` announces the task. The coding agent's final message, and nothing else, returns as the tool result when the turn ends. Narration before a tool call or under an earlier message id is dropped.

## Consequences

- The user hears progress only by asking; the app shows current tasks through `bomby.tasks` ([decision](tasks-as-an-agent-attribute.md)).
- `agent/prompts/harness-briefing.md` shapes the final message for speech.
