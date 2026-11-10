# Monorepo with a justfile module per part

Status: Accepted, 2026-11-03

## Context

The agent and the desktop app ship together and share contracts (job metadata, status events).

## Decision

One repo: `agent/` (Python, uv) and `app/` (Tauri). Shared docs in `docs/`, tools pinned in the root `mise.toml`.

Commands follow the owner's pattern across projects: the root `justfile` holds the repo-wide recipes (`install`, `tools`, `check`) and one `mod <part>` per part. Each part's recipes live in a root-level `<part>.just` (`agent.just`, `app.just`, `livekit.just`), run in the part's folder with `[working-directory: '...']`, and are called as `just agent console` or `just app build`. `just` and `just <part>` list them.

## Consequences

- Commands are run from the repo root through `just`, not from inside the folders.
- A new command gets a recipe with a doc comment, in the right group of its part's module.
- `just check` runs every part's `check`; a new part adds its own to it.
