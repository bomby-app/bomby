# Named Claude sessions in a call, with steering mid-turn

Status: Accepted, 2026-11-03. Supersedes the first build's one session per task.

## Context

With a fresh session per task, Claude forgot everything between requests, and the voice model had to restate the whole piece of work each time. But a call is not one conversation either: the user can run several unrelated pieces of work on the project at once, in parallel.

## Decision

A call works on one project (its folders), through one `claude-agent-acp` process. The `claude` tool takes a `session` name that the voice model picks per piece of work ("landing-page", "api-tests"):

- A new name opens a new Claude session; different sessions run in parallel.
- A name in use continues that session, so Claude keeps the context. Names are normalized (lowercase, dashes), so "Landing page" and "landing-page" are one session.
- Idle session: the request becomes a new prompt turn.
- Busy session: the request is steered into the running turn with the adapter's `_session/steering` extension (`idleBehavior: promptRequired`), and the tool returns at once; the running turn's result covers it. If the adapter doesn't advertise steering, the request waits for that session's running turn.
- Cancel stops the turn and keeps the session.
- Every session closes when the call ends.

## Consequences

- The voice model has to choose well between a new name and an existing one; its prompt tells it to ask when unsure.
- If the adapter process dies mid-call, each session's next request opens a new Claude session without the earlier context (logged as a warning).
- Session ids are the handle for resuming work in a later call (roadmap step 4), and the unit the app's Claude panel will show (step 2).
