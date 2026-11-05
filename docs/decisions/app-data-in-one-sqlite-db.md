# App data in one SQLite database

Status: accepted, 2026-11-03

## Context

The app needs to keep projects (a name and folders), the calls made on each project, and what was said in each call. LiveKit does not keep transcripts: they exist only while the call runs, as events in the room. If the app doesn't save them as they arrive, they are gone.

## Decision

- All app data lives in Tauri's `app_data_dir` (`~/Library/Application Support/app.bomby.desktop` on macOS; the platform equivalent elsewhere).
- One SQLite database there, owned by the Rust core. The page reads and writes only through core commands.
- Tables: `projects` (name, folders, instructions), `calls` (belongs to a project), `messages` (one transcript line per row, belongs to a call), `settings` (one row per key), and `agent_setups` with `agent_choices` (each agent's setup, [decision](set-up-every-agent-the-same-way.md)). Task status reaches the app separately through `bomby.tasks` ([decision](tasks-as-an-agent-attribute.md)).
- The app writes transcript lines itself as they arrive during the call.
- Secrets never go in the database; they stay in the keychain ([credentials-in-the-os-keychain.md](credentials-in-the-os-keychain.md)).
- The schema changes only through numbered migrations run by the core at startup.

## Why

- Projects, calls and messages are relational (a project has calls, a call has messages) and grow without bound; a JSON file would be rewritten whole on every line.
- One file in the standard app data folder is easy to back up, inspect and delete, and survives app updates.
- Keeping it in the core means one writer, typed commands, and no SQL in the page.

## Consequences

- A past call's conversation is rebuilt from `messages`, with the same transcript component as a live call.
- If the app is closed mid-call, lines already received are kept; nothing after.
- The SQLite library and migration approach are recorded in [tauri-notes.md](../tauri-notes.md#storage).
