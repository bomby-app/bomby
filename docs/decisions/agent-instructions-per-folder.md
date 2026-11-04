# Agent instructions in an AGENTS.md per folder

Status: accepted, 2026-11-04

## Context

One root `CLAUDE.md` held everything for agents: the layout, every rule for the agent, the app and the docs, and a summary of how we document. It loaded in full in every session, and much of it was either easy to find in the repo or a copy of `docs/`. Only Claude Code reads `CLAUDE.md`, while the other agents Bomby works with (OpenCode, omp, goose) read `AGENTS.md`.

## Decision

- Instructions live in `AGENTS.md` files, with a `CLAUDE.md` symlink to each: in the root, `agent/`, `app/` and `docs/`.
- The root file stays lean: what Bomby is and why, the stack with a link to each part, where to find things, and the rules for the whole repo.
- Each part's file holds only what matters when working there. `docs/README.md` became `docs/AGENTS.md` (the docs index and how we document), and `app/README.md` became `app/AGENTS.md` (the app's layout and conventions), so nothing is kept twice. The root `README.md` stays the page for people.

## Why

- Claude Code loads the `CLAUDE.md` files in the working directory and above it at launch, and a subfolder's only once it reads or edits a file there. It reads a `CLAUDE.md` symlinked to `AGENTS.md` once (code.claude.com/docs/en/memory, read 2026-11-04). So each part's rules cost nothing until work reaches that part.
- One file per folder serves every agent.

## Consequences

- A new part gets its own `AGENTS.md` and `ln -s AGENTS.md CLAUDE.md`.
- On a checkout without symlinks (Git on Windows without `core.symlinks`), each `CLAUDE.md` becomes a text file holding the path `AGENTS.md`, and Claude Code loses the instructions there.
