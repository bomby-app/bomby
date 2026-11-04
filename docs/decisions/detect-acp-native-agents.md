# Detect the agents on the user's computer, ACP-native first

Status: accepted, 2026-11-04. Extends [users-bring-their-own-keys-and-claude.md](users-bring-their-own-keys-and-claude.md): the user brings an agent, Claude Code or another.

## Context

People use more than Claude Code, and many agents speak ACP. Bomby should work with whichever the user has, without a setting for each, and without us shipping their software.

## Decision

- The core finds known agents on the computer (`app/src-tauri/src/agents.rs`): Claude Code, OpenCode, omp and goose today. It looks each program up through the user's login shell, then in its usual install places, and reads its version (and Claude's sign-in).
- Only agents that speak ACP themselves are added (`opencode acp`, `omp acp`, `goose acp`). Claude Code is the exception, through the `claude-agent-acp` adapter we already ship. Agents that need a third-party adapter (pi through `pi-acp`) wait: we'd have to bundle it.
- Each call re-detects, and the found agents go to the voice agent in the job metadata (`"agents": {"claude": "/path/claude", ...}`). The voice model can only use those; the default is Claude when it's installed.
- Settings has an Agents section listing what the core reports; Setup keeps only the keys.

## Adding an agent

1. A row in `KNOWN` in `agents.rs`: id, name, program, usual install places, optional sign-in check.
2. A `Harness` in `agent/harnesses/` with the same id: `program` and `args` for a native agent, or `adapter` and `program_env` for one behind an adapter. List it in `HARNESSES` and add its id to `AgentName`.
3. Optionally a logo in `app/src/features/agents/agent-logos.tsx`.

## Consequences

- OpenCode and omp run with the user's own setup (providers, models, rules). They have no steering or bypass mode we rely on: a mid-task request waits for the running turn, and permission requests are approved once.
- A call needs at least one agent; with none, starting one says so and points at Settings, Agents.
