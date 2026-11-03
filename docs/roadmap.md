# Roadmap

Status: `done`, `in progress`, `next`, `later`. Update this file whenever a step moves.

| # | Step | Status | Notes |
| --- | --- | --- | --- |
| 0 | Voice agent with a background `claude` tool over ACP | done | One session per task. Tested by the owner in console. |
| 1 | Agent: project and folders from dispatch metadata, named parallel Claude sessions, steering mid-turn | in progress | Built and unit-tested; waiting on the owner's console test. See [named Claude sessions](decisions/named-claude-sessions.md). |
| 2 | Agent: Claude status events to the frontend over LiveKit text streams | next | Started, tool calls, finished, result. Gemini still only gets the final result. Send them from a queue, never by awaiting in `session_update` (see [acp-notes.md](acp-notes.md#replies)). |
| 3 | Desktop app (`app/`): Tauri v2, React, LiveKit Agents UI | in progress | Scaffolded (Tauri 2.12, React, Vite, bun) with a mic check page. Mic capture works in `tauri dev` on macOS (owner tested); the bundled app's own prompt is not tested yet. Next: project sidebar, call view, Claude panel. Tauri core stores projects and creates tokens. See [desktop app on Tauri v2](decisions/desktop-app-on-tauri-v2.md). |
| 4 | Resume a project's Claude sessions in a later call | later | Store the session ids with the project; resume them over ACP. Design by the owner. |
| 5 | Permission layers | later | Folders are a scope today, not a fence. See [bypass permissions for now](decisions/bypass-permissions-for-now.md). |

## Deliberately not handled yet

- **Long calls.** Gemini reconnects around 10 minutes and caps audio at 15 minutes without context compression. No compression or resumption logic until the owner designs it. See [gemini-notes.md](gemini-notes.md).
- **Linux voice in the app.** WebKitGTK ships without reliable WebRTC. If Linux matters, run the call natively through LiveKit's Rust SDK in the Tauri core. See [desktop app on Tauri v2](decisions/desktop-app-on-tauri-v2.md).
- **Voice permission prompts.** `ctx.foreground()` is the LiveKit hook for them, once permissions stop being bypassed.
