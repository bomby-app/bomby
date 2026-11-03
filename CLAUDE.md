# claude-livekit

Talk to Claude Code. A voice agent (LiveKit Agents, Python, Gemini 3.8 Live) hands real work to a Claude Code session over **ACP** and speaks Claude's result when it is done. A desktop app (Tauri v2, planned) holds the projects and runs the call.

**Read [docs/README.md](docs/README.md) first**, then [docs/architecture.md](docs/architecture.md) and [docs/roadmap.md](docs/roadmap.md). Why things are the way they are is in [docs/decisions/](docs/decisions/).

## Layout

| Path | What |
| --- | --- |
| `agent/` | The voice agent (uv project). `agent.py` entrypoint, `tools/claude.py` the Claude runner and tool, `prompts/` the two prompts, `tests/` with a fake ACP agent. |
| `app/` | The desktop app: Tauri v2, React frontend in `src/`, Rust core in `src-tauri/`. See `docs/tauri-notes.md`. |
| `docs/` | Architecture, roadmap, decisions, library notes. |
| `justfile`, `agent.just`, `app.just` | Every main command, run from the repo root. The root `justfile` has repo-wide recipes and one `mod` per part: `just agent console`, later `just app build`. `just` lists them. |
| `mise.toml` | Pinned tools: `lk`, `claude-agent-acp`, `rust`, `bun`. |

## Rules

- **Run commands through `just`** from the repo root. A new main command gets a recipe in its part's module (`agent.just`, later `app.just`) with a doc comment, a group and `[working-directory: '...']`. A new part gets its own `<part>.just` and a `mod <part>` line in the `justfile`.
- **`just check` must pass** (lint, types with 0 errors and 0 warnings, tests) before a change is done. Fix any lint, type or test failure you see, related or not.
- **Don't run dev servers, `lk agent console` or the app (`just app dev`).** Builds and checks are fine. Report what to run; the owner tests first.
- **Only `uv` for Python deps.** Pin new tools in `mise.toml`. No system-level installs.
- **Never trust memory for LiveKit, Gemini, ACP or Tauri APIs.** They move fast. Check the installed source and current docs, and record what you found in the matching `docs/*-notes.md` with source and version.
- **Never name a file `claude.md`.** macOS is case-insensitive, so it is `CLAUDE.md`, which Claude Code loads as instructions.
- **Secrets live only in `agent/.env`** (gitignored). Never pass them to Claude: the runner strips `.env` keys and Anthropic credentials from Claude's environment.
- **Long Gemini sessions are deliberately unhandled.** No compression or resumption logic unless the owner asks.
- **Claude's output reaches Gemini only as the tool result.** No `session.generate_reply` pushes. See `docs/decisions/results-only-as-tool-results.md`.

## How we document

Full rules in [docs/README.md](docs/README.md#how-we-document). In short:

- Docs change in the same commit as the code they describe.
- A decision someone could question gets a record in `docs/decisions/short-title.md`; superseded records are marked, never rewritten.
- Keep `docs/roadmap.md` true: update a step's status when it moves.
- Library facts go in `docs/*-notes.md` with their source and version.
- This file stays short: rules and pointers. Details go in `docs/`.
- Plain, short writing. No em dashes.
