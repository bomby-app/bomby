# Extensions, and to-dos as the first

Status: accepted, 2026-11-08

## Context

The owner wants Bomby to keep a to-do list for each project together with the user: Bomby adds, ticks off and tidies to-dos while they talk, and the user sees and edits the same list in the app. More tools like it will follow, so it should plug in the way voice providers and harnesses do, not grow `tools/` one tool at a time (owner, 2026-11-08).

The app's Rust core is the database's only writer ([decision](app-data-in-one-sqlite-db.md)), and the voice agent runs in a separate Python worker that exists only during a call.

## Decision

- **An extension is one definition** in `agent/extensions/` (`todos.py`), listed in `EXTENSIONS`: its id, name, a line for Settings, whether it's on by default, a note for the instructions of whichever model calls the tools, and its tools for one call (`Extension` in `extension.py`). The definitions are the one catalogue: `just agent extensions` writes `app/src-tauri/extensions.json`, which the core embeds, and `just agent check` fails when it's out of date.
- **On or off in two places.** Settings, Extensions turns each on or off for every project; Project settings, Extensions follows Settings ("Same as Settings") or picks for the project alone (owner, 2026-11-08). A call's extensions are fixed when it opens, like its agents and voice.
- **The app keeps the data; the agent asks over LiveKit RPC.** A tool calls `bomby.<extension>.<op>` on the app's page, the room's `user` participant, which asks the core and answers with JSON (`agent/extensions/bridge.py`). The core refuses with a message for the user, which the page sends back as `RpcError` code 2000 and the voice model hears as is. The app sends what an extension needs at the start of a call in the job's metadata (`extensions`), so Bomby knows the open to-dos from the first word.
- **Tools are fixed for the call.** The voice model gets every extension's tools when the session connects. A note in the instructions, plus the tools' own descriptions, tell it how to use them; nothing loads mid-call.
- **To-dos, never tasks.** A task is work handed to a coding agent (`start_task`, the agents panel); the list's items are to-dos, and its tools `list_todos`, `add_todos`, `update_todo` and `remove_todo`, so the model never mixes them up (owner, 2026-11-08). Statuses: to do, doing, done and cancelled. Each to-do has a number of its own in the project, never reused, so the user can say "number 6".

## Why

- **RPC through the page, not a server in the core or the worker writing SQLite.** It rides the room every call already has: no port, token or server to run and defend, and the core stays the one writer and tells every window when the list changes. The page is always in the room while the agent exists, which is only during a call.
- **No mid-call tool loading.** LiveKit Agents 1.8.11 has no skills. `Agent.update_tools` exists, but Gemini's plugin restarts its Live session to apply it (`_mark_restart_needed`, docs/livekit-notes.md), which the user would hear. A short note and good tool descriptions cost nothing at run time; a "read the guide" tool would add a round trip before the first use, so it waits until a note outgrows the instructions.
- **Typed at every hop.** The model fills a tool's typed arguments, which LiveKit checks; the agent builds the payload; the page passes it to a command whose Rust struct checks it again.

## Consequences

- An extension works only in calls from the app. Console runs have none: no page answers RPC there.
- The page must be connected for a tool to work. If it isn't (closed mid-call, a slow reconnect), the tool fails with one line ("The app didn't answer, so that didn't change.") and the details go to the log.
- RPC payloads stay under 15 KiB each way (LiveKit's v1 limit, which applies unless both sides speak v2), so listings are short: `list_todos` sends what was asked, and the start of a call sends at most 30 open to-dos.
- Adding an extension: its definition and tests in `agent/extensions/`, `just agent extensions`, its data and commands in the core (`app/src-tauri/src/extensions/`), and its RPC handlers and UI in a feature of its own, listed with the page's extensions.
