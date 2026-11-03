# Ship the agent and the adapter as sidecars

Status: proposed, 2026-11-03. Becomes accepted, with the packaging details, after the prototypes below.

## Context

A call runs two programs next to the app: the Python voice agent (`agent/`) and the `claude-agent-acp` adapter (Node). Users shouldn't need Python, uv, Node or mise. Users bring Claude Code themselves ([users-bring-their-own-keys-and-claude.md](users-bring-their-own-keys-and-claude.md)).

## Proposal

- Both ship inside the app as Tauri sidecars (`bundle.externalBin`), one binary per OS and architecture.
- **Adapter**: compiled into one binary with `bun build --compile`, leaving out the Agent SDK's native `claude` binary (`@anthropic-ai/claude-agent-sdk-<platform>`, 305 MB in 0.100.0 on darwin-arm64). The app sets `CLAUDE_CODE_EXECUTABLE` to the user's own `claude`; adapter 0.100.0 reads it first in `claudeCliPath()` (`dist/acp-agent.js`).
- **Agent**: frozen into one binary per OS with PyInstaller or Nuitka (to be chosen by prototype).
- The app starts the agent for a call with the LiveKit and Gemini keys from the keychain as environment variables, and the adapter path. Keys never touch disk.

## To verify by prototype first

1. The adapter as one bun binary: does it run, start sessions and stream with the user's `claude` through `CLAUDE_CODE_EXECUTABLE`? Size?
2. The Python freezer: which of PyInstaller and Nuitka handles `livekit-agents`, the Google plugin and their native pieces (audio, protobuf, `livekit` rtc FFI)? Size and start time?

Packaging is not built until both answer yes; the results and the final choice go into this record or a new one.

## Consequences

- One app download per platform, no runtimes to install.
- The agent's `agent/.env` stays a dev-only path; in the app, keys come from the keychain.
