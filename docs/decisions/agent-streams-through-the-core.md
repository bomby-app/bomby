# The Agents panel streams each coding agent through the core, for the call only

Status: accepted, 2026-11-11

## Context

While a coding agent works on a task, the owner wants to watch it: a panel listing the agents running now in the call, and for the one selected, its messages and tool calls as they happen. Read-only, minimal, no thinking and saved nowhere (owner, 2026-11-11). He first asked for it only while the agent runs; after trying it, for it to stay until the call ends, with one row for a session however many tasks it takes (owner, 2026-11-11). Its toggle was first in every page's header of the project, so it never came and went; with no call on it opened an empty panel, so it now shows with the call's agents panel only (owner, 2026-11-11).

Everything the agents send reaches the voice agent over ACP (`agent/acp_client/`). The page sees tasks only through the `bomby.tasks` attribute ([decision](tasks-as-an-agent-attribute.md)), which carries no activity. What a stream carries is the user's own work: messages about their code, and tool titles that are often whole command lines, which can hold a token.

## Decision

- **It shows two things.** The agent's message text as it writes it, and each tool call as one line with its title and status (running, failed, or done). No thinking, plans, tool output, diffs, terminals, permission prompts or raw JSON.
- **A stream is a session's turn**, not a task: a request steered into a running turn shares its stream. The panel lists one row per agent and session, and a session's turns follow one another in its row, each between a mark where it started and one where it finished.
- **It's on the running call's page only.** Its toggle, its panel and its entry in the command palette are there with the call's agents panel, and go when the call ends or the page is another: anywhere else it has nothing to show.
- **It lasts as long as the call.** The core holds the call's turns in memory, the finished ones too, so a panel opened at any point shows all of it, and drops them when the call ends (the worker's connection closes). A call holds about 8 MiB and 256 turns; past either, its oldest finished turns go. Nothing is written to disk, the database, the logs or Export diagnostics.
- **It goes through the core, not LiveKit.** The voice agent sends events to the core over a local socket, set up like the hosted MCP extensions' token socket ([decision](hosted-mcp-extensions-with-oauth.md)): a folder only the user can open and a per-run secret, both in the worker's environment (`BOMBY_STREAMS`, `BOMBY_STREAMS_SECRET`) and never in a coding agent's (`APP_KEYS`). The core passes them to the page over a Tauri `Channel`. Console runs have no core and don't stream.
- **Recording never touches a result.** The client records after it has updated the final message, synchronously, guarded, into a bounded queue; a full queue drops events and says so, and a missing or stuck core stops the call's stream, never the task. Text is batched for 100 ms, titles cut at 200 characters and a message at 16,000, before anything is serialized; the core holds a message to 64 KiB itself, which is that cut at its largest, so a worker that lets more through can't outgrow its budget. A turn is known by its agent and its ACP session id together, since the id is only the agent's own. Only the standard ACP fields (message text, tool call id, title, kind and status) are read.

## Why

- **The core over LiveKit text streams.** Through LiveKit, the user's code and command lines would leave the Mac whenever calls use LiveKit Cloud, and a panel opened late would need a replay the agent must hold and serve within LiveKit's RPC limits. The core keeps it on the Mac, holds the replay, survives a page reload and keeps the traffic off the call's connection. The socket is a pattern the app already runs.
- **The call, and no longer.** The voice already reports each result and the transcript keeps it. Whole streams are large (some agents send whole files per edit) and hold code and command output; saving them would need storage, limits and migrations for little use. Held in the core rather than the page, they survive a page reload and a panel opened late, and the core stays the one place the page reads from.
- **Standard fields only.** Five agents that change often send very different extras ([notes](../acp-notes.md#streams)); reading only what ACP defines means an agent that changes shows less, never breaks.

## Consequences

- A second socket in the core, beside the token socket, and a new event loop task in each call's job; the job's loop also carries the call's audio, which is why the caps apply before serializing.
- An agent that sends no tool titles shows a fallback by kind ("Running a command"); goose sends no kind, so its untitled calls read "Using a tool".
- Some events can be dropped under load (a marker says so); the turn's start and end never are.
- Steering adds nothing to the stream: the joined request's work is the same turn.
