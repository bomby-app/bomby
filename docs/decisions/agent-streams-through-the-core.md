# The Agents panel streams a running turn through the core, and keeps nothing

Status: accepted, 2026-11-11

## Context

While a coding agent works on a task, the owner wants to watch it: a panel listing the agents running now in the call, and for the one selected, its messages and tool calls as they happen. Read-only, minimal, no thinking, saved nowhere, and only while the agent runs (owner, 2026-11-11).

Everything the agents send reaches the voice agent over ACP (`agent/acp_client/`). The page sees tasks only through the `bomby.tasks` attribute ([decision](tasks-as-an-agent-attribute.md)), which carries no activity. What a stream carries is the user's own work: messages about their code, and tool titles that are often whole command lines, which can hold a token.

## Decision

- **It shows two things.** The agent's message text as it writes it, and each tool call as one line with its title and status (running, failed, or done). No thinking, plans, tool output, diffs, terminals, permission prompts or raw JSON.
- **A stream is a session's running turn**, not a task: a request steered into a running turn shares its stream. The panel lists one row per agent and session ("Claude · landing-page").
- **It exists only while the turn runs.** The core holds a running turn's events in memory, so a panel opened halfway isn't empty, and drops them the moment the turn ends, however it ends. Nothing is written to disk, the database, the logs or Export diagnostics.
- **It goes through the core, not LiveKit.** The voice agent sends events to the core over a local socket, set up like the hosted MCP extensions' token socket ([decision](hosted-mcp-extensions-with-oauth.md)): a folder only the user can open and a per-run secret, both in the worker's environment (`BOMBY_STREAMS`, `BOMBY_STREAMS_SECRET`) and never in a coding agent's (`APP_KEYS`). The core passes them to the page over a Tauri `Channel`. Console runs have no core and don't stream.
- **Recording never touches a result.** The client records after it has updated the final message, synchronously, guarded, into a bounded queue; a full queue drops events and says so, and a missing or stuck core stops the call's stream, never the task. Text is batched for 100 ms, titles cut at 200 characters and a message at 16,000, before anything is serialized; only the standard ACP fields (message text, tool call id, title, kind and status) are read.

## Why

- **The core over LiveKit text streams.** Through LiveKit, the user's code and command lines would leave the Mac whenever calls use LiveKit Cloud, and a panel opened late would need a replay the agent must hold and serve within LiveKit's RPC limits. The core keeps it on the Mac, holds the replay, survives a page reload and keeps the traffic off the call's connection. The socket is a pattern the app already runs.
- **Only the running turn.** The voice already reports each result and the transcript keeps it. Whole streams are large (some agents send whole files per edit) and hold code and command output; keeping them would need storage, limits and migrations for little use.
- **Standard fields only.** Five agents that change often send very different extras ([notes](../acp-notes.md#streams)); reading only what ACP defines means an agent that changes shows less, never breaks.

## Consequences

- A second socket in the core, beside the token socket, and a new event loop task in each call's job; the job's loop also carries the call's audio, which is why the caps apply before serializing.
- An agent that sends no tool titles shows a fallback by kind ("Running a command"); goose sends no kind, so its untitled calls read "Using a tool".
- Some events can be dropped under load (a marker says so); the turn's start and end never are.
- Steering adds nothing to the stream: the joined request's work is the same turn.
