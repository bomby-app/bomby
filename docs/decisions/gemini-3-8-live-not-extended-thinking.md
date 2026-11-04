# Default to gemini-3.8-live, not Extended Thinking

Status: Accepted, 2026-11-03

## Context

In the first console test on `gemini-3.8-live-extended-thinking`, Gemini interrupted its own turn while calling `lk_agents_get_running_tasks`. LiveKit marks an interrupted turn's tool output as needing no reply, the Google plugin then sends it with `scheduling: SILENT`, and Extended Thinking rejects any scheduling with a fatal `1007 Function response scheduling is not supported for this model`. The same is reported on Google's forum. The same test also never voiced Claude's result. On `gemini-3.8-live` every result was voiced and nothing crashed.

## Decision

`MODEL=fast` (`gemini-3.8-live`) is the default and the one we build on. `MODEL=thinking` stays available for experiments only.

## Consequences

- Revisit when the plugin stops sending `scheduling` to Extended Thinking or Google supports it there.
- Silent tool updates (`ctx.update(silent=True)`) are off the table on Extended Thinking.
