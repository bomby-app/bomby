# Roadmap

Status: `done`, `in progress`, `next`, `later`. Update this file whenever a step moves.

| # | Step | Status | Current state |
| --- | --- | --- | --- |
| 0 | Voice agent with a background `claude` tool over ACP | done | Tested in console. Named sessions superseded one session per task. |
| 1 | Project metadata, named parallel sessions and mid-turn steering | in progress | Built and unit-tested; console test [#7](https://github.com/bomby-app/bomby/issues/7). Harnesses cover Claude Code, Codex, OpenCode, omp and goose through shared ACP code and `start_task`. The app detects installed agents and passes them with each call ([decision](decisions/detect-acp-native-agents.md), [sessions](decisions/named-claude-sessions.md)). |
| 2 | Task status in the frontend | in progress | Built; test [#8](https://github.com/bomby-app/bomby/issues/8). The agent participant's `bomby.tasks` attribute drives the call header's agents panel ([decision](decisions/tasks-as-an-agent-attribute.md)). Progress inside a task: [#9](https://github.com/bomby-app/bomby/issues/9). Gemini still receives only final results. |
| 3 | Desktop app: Tauri v2, React, LiveKit Agents UI | in progress | Shell, shadcn Radix, themes, macOS overlay title bar and settings are built. LiveKit and Gemini credentials use the keychain. Mic capture works in `tauri dev`; the bundled app's prompt: [#10](https://github.com/bomby-app/bomby/issues/10) ([Tauri decision](decisions/desktop-app-on-tauri-v2.md)). |
| 3a | Name and brand | in progress | Renamed to Bomby, including identifiers, packages and wordmark ([decision](decisions/name-bomby.md)). Tagline, logo, colours and DMG background are done. The macOS 26+ icon review and the tray icon: [#11](https://github.com/bomby-app/bomby/issues/11). See [brand.md](brand.md). |
| 3b | Storage and project tree | in progress | Built; test [#12](https://github.com/bomby-app/bomby/issues/12). Core-owned SQLite and migrations, project commands, sidebar tree, project creation/editing and native folder picker ([storage](decisions/app-data-in-one-sqlite-db.md), [sidebar](decisions/sidebar-tree-of-projects-and-calls.md)). |
| 3c | Gemini key and setup checks | in progress | Built; test [#12](https://github.com/bomby-app/bomby/issues/12). The first-run splash sets up the first agent and the keys, then opens the projects home ([brand](brand.md#first-run)). Settings shows LiveKit and Gemini readiness, and each agent's setup (sign-in, provider, model) from an ACP probe ([keys](decisions/users-bring-their-own-keys-and-claude.md), [probe](decisions/check-agent-setup-with-an-acp-probe.md)). |
| 3d | The call | in progress | LiveKit session handling, saved transcripts, resume with the last 50 lines, voice picker and persona are built. Bluetooth output echoes under WebKit's voice processing ([#3](https://github.com/bomby-app/bomby/issues/3)): use wired output; fallback [#4](https://github.com/bomby-app/bomby/issues/4). Mascot working and done states: [#13](https://github.com/bomby-app/bomby/issues/13). |
| 4 | Resume a project's agent sessions in a later call | later | [#15](https://github.com/bomby-app/bomby/issues/15) |
| 5 | Permission layers | later | [#16](https://github.com/bomby-app/bomby/issues/16). Folders are a scope, not a fence ([decision](decisions/bypass-permissions-for-now.md)). |
| 6 | Packaging prototypes | done | Compiled adapter passes. PyInstaller folder starts in 0.8 s; one-file starts too slowly and Nuitka builds too slowly ([decision](decisions/ship-the-agent-and-adapter-as-sidecars.md)). |
| 7 | Ship the sidecars | later | [#2](https://github.com/bomby-app/bomby/issues/2). Release builds have no agent until then. Adapters aren't shipped: Set up installs them ([decision](decisions/install-adapters-on-setup.md)). |

## Deliberately not handled yet

- **Long calls.** Gemini reconnects around 10 minutes and caps audio at 15 minutes without context compression. No compression or resumption logic until it is designed ([notes](gemini-notes.md)).
- **Linux voice.** WebKitGTK lacks reliable WebRTC. If Linux matters, capture and play through LiveKit's Rust SDK in the core ([decision](decisions/desktop-app-on-tauri-v2.md)).
- **Voice permission prompts.** Use `ctx.foreground()` once permissions are no longer bypassed.
