# Roadmap

Status: `done`, `in progress`, `next`, `later`. Update this file whenever a step moves.

| # | Step | Status | Notes |
| --- | --- | --- | --- |
| 0 | Voice agent with a background `claude` tool over ACP | done | One session per task. Tested by the owner in console. |
| 1 | Agent: project and folders from dispatch metadata, named parallel Claude sessions, steering mid-turn | in progress | Built and unit-tested; waiting on the owner's console test. See [named Claude sessions](decisions/named-claude-sessions.md). |
| 2 | Agent: Claude status events to the frontend over LiveKit text streams | next | Started, tool calls, finished, result. Gemini still only gets the final result. Send them from a queue, never by awaiting in `session_update` (see [acp-notes.md](acp-notes.md#replies)). |
| 3 | Desktop app (`app/`): Tauri v2, React, LiveKit Agents UI | in progress | Tauri 2.12, React, Vite, bun. Done: mic capture in `tauri dev` (owner tested; the bundled app's own prompt not yet), shell on shadcn Base UI ([decision](decisions/app-ui-on-shadcn-base-ui.md)), themes, macOS overlay title bar, settings window with LiveKit credentials in the keychain. See [desktop app on Tauri v2](decisions/desktop-app-on-tauri-v2.md). |
| 3a | Rename to Claudible and apply the brand | in progress | Done in code, waiting on the owner's look: product name, identifier `com.aburady.claudible`, Dot Dot logo and wordmark, brand colours in light and dark, app icons from the Paper file. macOS 26+ icon done (`Claudible.icon` compiled to Assets.car by `just app icon`; waiting on the owner's look in Icon Composer and the Dock). DMG background done. Waits: tray icon. See [name](decisions/name-claudible.md), [brand.md](brand.md). |
| 3b | Storage and the project tree | in progress | Built, waiting on the owner's test: SQLite in the core with migrations, project commands with unit tests, the sidebar tree, a New project row (Cmd+N) opening a dialog with name and folders, the project view (rename inline, folders with the working one first, add with the native picker, delete with a confirm). Calls show in the tree once the call step creates them. SQLite in the core ([decision](decisions/app-data-in-one-sqlite-db.md)); sidebar tree of projects and calls ([decision](decisions/sidebar-tree-of-projects-and-calls.md)); create and edit projects with a native folder picker. |
| 3c | Gemini key and requirement checks in Settings | next | Gemini key in Credentials (keychain); each requirement shown ready or missing, Claude sign-in from `_auth/status_update` ([decision](decisions/users-bring-their-own-keys-and-claude.md)). |
| 3d | The call | later | Token minting in the core, call view with Agents UI, transcript saved to SQLite, past calls replayed from it, the Dot Dot mascot driven by agent state. |
| 6 | Packaging prototypes | next | Adapter as one `bun build --compile` binary with the user's `claude`; PyInstaller vs Nuitka for the agent, size and start time. No packaging built until both pass ([proposal](decisions/ship-the-agent-and-adapter-as-sidecars.md)). |
| 7 | Ship the sidecars | later | The app starts the agent and adapter with keys from the keychain. Needs step 6. |
| 4 | Resume a project's Claude sessions in a later call | later | Store the session ids with the project; resume them over ACP. Design by the owner. |
| 5 | Permission layers | later | Folders are a scope today, not a fence. See [bypass permissions for now](decisions/bypass-permissions-for-now.md). |

## Deliberately not handled yet

- **Long calls.** Gemini reconnects around 10 minutes and caps audio at 15 minutes without context compression. No compression or resumption logic until the owner designs it. See [gemini-notes.md](gemini-notes.md).
- **Linux voice in the app.** WebKitGTK ships without reliable WebRTC. If Linux matters, run the call natively through LiveKit's Rust SDK in the Tauri core. See [desktop app on Tauri v2](decisions/desktop-app-on-tauri-v2.md).
- **Voice permission prompts.** `ctx.foreground()` is the LiveKit hook for them, once permissions stop being bypassed.
