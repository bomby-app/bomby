# Ship the agent and the adapter as sidecars

Status: accepted, 2026-11-04. Proposed 2026-11-03.

## Context

A call runs two programs next to the app: the Python voice agent (`agent/`) and the `claude-agent-acp` adapter (Node). Users shouldn't need Python, uv, Node or mise. Users bring Claude Code themselves ([users-bring-their-own-keys-and-claude.md](users-bring-their-own-keys-and-claude.md)).

## Decision

- Bundle both programs per OS and architecture: the adapter as a Tauri sidecar (`bundle.externalBin`), the agent as a folder in app resources.
- **Adapter**: compiled into one binary with `bun build --compile`, leaving out the Agent SDK's native `claude` binary (`@anthropic-ai/claude-agent-sdk-<platform>`, 305 MB in 0.100.0 on darwin-arm64). The app sets `CLAUDE_CODE_EXECUTABLE` to the user's own `claude`; adapter 0.100.0 reads it first in `claudeCliPath()` (`dist/acp-agent.js`).
- **Agent**: frozen with PyInstaller, as a folder (`--onedir`), shipped in the app's resources and started by path (chosen by the prototypes below).
- The app starts the agent for a call with the LiveKit and Gemini keys from the keychain as environment variables, and the adapter path. Keys never touch disk.

## Prototype results (2026-11-04, macOS 27, arm64)

**Adapter: passes.** `bun build --compile --minify` on `@agentclientprotocol/claude-agent-acp` 0.100.0 installed with `--omit optional` gives one 91 MB binary (mostly the bun runtime; the SDK's native `claude` is 305 MB). With `CLAUDE_CODE_EXECUTABLE` set to the user's `claude` (2.1.317) it initializes in 0.1 s, pushes `_auth/status_update` with the user's account and plan, and opens a session in 0.9 s, the same as the Node adapter. No prompt was sent.

**Agent with PyInstaller 6.22.3: works, only as a folder.** Entry `claudible_agent.py` (`multiprocessing.freeze_support()`, then the agent's CLI), `--collect-all livekit --collect-submodules livekit.plugins --collect-data google.genai --add-data prompts`. Imports, the Google plugin and `liblivekit_ffi` load, and the CLI runs.

| Build | Size | First start | Later starts |
| --- | --- | --- | --- |
| `--onefile` | 112 MB | 26 s | 18 s, every time |
| `--onedir` | 190 MB folder | 17 s | 0.8 s |

A one-file build unpacks to a new temp folder on every start, so macOS checks every native library again each time; a folder build pays that once. So the agent ships as a folder (launched by path from the app's resources), not as a single `externalBin`.

**Agent with Nuitka 4.3.4: stopped.** `--standalone` compiled 3,778 modules to C; after 25 minutes it was still on one file, `google.genai.types` (Nuitka itself warned "Slow C compilation detected ... scalability problem" at 360 s). A build that long per platform and per release is a poor fit, and PyInstaller already meets the bar, so we stopped it without a size or start time.

**Choice: PyInstaller, one folder.** 40 s builds, 0.8 s starts, everything loads. Revisit Nuitka only if the folder size or start time becomes a problem.

## Consequences

- One app download per platform, no runtimes to install.
- The agent's `agent/.env` stays a dev-only path; in the app, keys come from the keychain.
- Codex adds a second adapter (`codex-acp`, which bundles its own Codex; leave that out and set `CODEX_PATH`, as with Claude). Development already builds both this way (`just agent install`, [acp-notes](../acp-notes.md#adapters)). The owner prefers installing adapters into the app's folder when an agent is set up, as Zed does from the ACP Registry, over bundling each one (2026-11-04); step 7 decides, after checking the registry's format.
- The frozen agent has two entries: the worker (`agent.py start`) and the setup probe (`probe.py`, [decision](check-agent-setup-with-an-acp-probe.md)). The bundle's entry script dispatches on its first argument, and the core runs it with `probe` for Settings.
