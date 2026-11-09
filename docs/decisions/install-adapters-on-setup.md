# Install ACP adapters when an agent is set up

Status: accepted, 2026-11-04. Replaces the adapter part of [ship-the-agent-and-adapter-as-sidecars.md](ship-the-agent-and-adapter-as-sidecars.md).

## Context

Claude Code and Codex reach ACP only through adapters, npm packages that need a JS runtime. Shipping a compiled copy inside Bomby, as step 6 planned, redistributes their code: `claude-agent-acp` includes Anthropic's Claude Agent SDK ("All rights reserved", listed `proprietary` in the ACP Registry), which also makes signing the app harder. The ACP Registry lists both adapters only as `npx` packages, and editors like Zed install them on demand from it instead of bundling them.

## Decision

- **The user's Mac installs them, on Set up** (owner, 2026-11-04). The first-run splash and Settings, Agents show Set up for an installed agent whose adapter is missing. It downloads bun (pinned version, checked against its SHA-256), installs the adapters from npm with the lockfile Bomby ships (`agent/adapters/package.json` and `bun.lock`, so npm's integrity hashes are checked), and compiles each into one program, all in `~/Library/Application Support/app.bomby.desktop/adapters/` (`app/src-tauri/src/adapters.rs`). Optional packages, which hold the agents' own bundled binaries, are never installed.
- **Every adapter at once.** One Set up installs every adapter in the lockfile; it takes seconds once bun is there, and the next agent is ready without asking again.
- **Versions come with Bomby.** An app update with a new lockfile rebuilds the adapters in the background at launch; one that fails is removed, so Settings offers Set up again. Nothing updates on its own between releases.
- **The voice agent runs them by path** from `BOMBY_ADAPTERS`, which the core sets, with the user's own program in `CLAUDE_CODE_EXECUTABLE` or `CODEX_PATH`. The adapter runs as the user, on their own login and config (`~/.claude`, `~/.codex`).
- **Development uses the same path.** `just app dev` installs through Set up like a release; `just agent install` builds the repo's copy for console runs.

## Consequences

- The first Set up needs the internet: about 40 MB for bun, a few MB for the packages, and 90 MB on disk per compiled adapter.
- The bun download retries a timeout, 408, 429 and 5xx three times (curl over HTTP/1.1, since curl 8.7 won't retry over HTTP/2). A failure says "Try again in a minute!" with the HTTP code, or "no connection"; curl's own error goes to `adapters/install.log`. A company network can block the download: it needs `github.com`, `release-assets.githubusercontent.com` and `registry.npmjs.org`.
- Bomby redistributes nothing of the adapters or the agents.
- The probe reports an agent without its adapter as needing setup, and calls leave it out until it's installed.
