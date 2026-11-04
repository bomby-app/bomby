# Bomby

## What and why

Bomby is a macOS desktop app you talk to. You say what you want done, and Bomby's voice agent hands it to a coding agent already installed on the computer (Claude Code, OpenCode, omp or goose), keeps the conversation going while it works, and tells you the result when it's done. You can run several tasks at once, add to one while it runs, and resume an earlier call.

Why: talking is the fastest way to hand off work ("Stop typing. Start talking."). Bomby works with the agent the user already has, on their own setup, and with their own LiveKit and Gemini keys, so we host nothing and hold no one's keys or logins.

It is in beta and runs from source; packaging comes later. The owner designs and tests it; agents write the code.

> Keep this section true whenever the product changes.

## Stack

- **Voice agent**, `agent/`: Python on uv, LiveKit Agents, Gemini 3.8 Live, and an ACP client that drives the coding agents. See [agent/AGENTS.md](agent/AGENTS.md).
- **Desktop app**, `app/`: Tauri v2. A Rust core (SQLite, keychain, finding the agents, running the voice agent) and a React frontend (Vite, bun, shadcn on Radix, Tailwind v4, LiveKit Agents UI). See [app/AGENTS.md](app/AGENTS.md).
- **Tooling**: `just` for every command, `mise` for pinned tools.

## Where to find things

- [docs/architecture.md](docs/architecture.md): the pieces, how a call flows, the contracts between them.
- [docs/roadmap.md](docs/roadmap.md): what's built, what's next, what's deliberately not done.
- [docs/decisions/](docs/decisions/): why things are the way they are.
- [docs/AGENTS.md](docs/AGENTS.md): every other doc, and how we document.

## Rules

- Run commands through `just` from the repo root; `just` lists them.
- `just check` must pass (lint, types with 0 errors and 0 warnings, tests) before a change is done. Fix any failure you see, related or not.
- Don't run the app (`just app dev`), `just agent console` or any dev server unless the owner explicitly approves it. Builds and checks are fine; tell the owner what to run.
- Never trust memory for LiveKit, Gemini, ACP or Tauri APIs. Check the installed source and current docs, and record what you find in the matching `docs/*-notes.md` with source and version.
- Pin new tools in `mise.toml`. No system-level installs.
- Secrets live only in `agent/.env` (gitignored) and the OS keychain.
- No personal details in docs, comments or tests: no one's devices, accounts or other apps, and no real local paths. Use placeholders like `/Users/me/...`. The repo will be open source.
- Docs change in the same commit as the code they describe ([how we document](docs/AGENTS.md#how-we-document)).
