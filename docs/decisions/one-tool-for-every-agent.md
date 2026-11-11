# One tool for every agent

Status: accepted, 2026-11-04

## Context

Bomby will drive more agents that speak ACP than Claude Code (Pi, omp, Goose and others). The voice model needs a way to hand work to each. Gemini Live receives its tools once, when the session connects, so whatever we choose has to be fixed before the call starts.

## Decision

- The voice model has one tool, `start_task(task, session, agent)` (`agent/tools/start_task.py`).
- `agent` is a fixed set of names (`AgentName`, a `Literal` in `agent/harnesses/__init__.py`), one per harness in `HARNESSES`; a test keeps the two in step. Current ids are `claude`, `codex`, `opencode`, `omp` and `goose`.
- Each harness is one `Harness` definition (`agent/harnesses/`); the runner, sessions, steering and results are shared.

## Why

- One tool with a stable schema, defined at import time, is what Gemini Live handles best; Google's Live API guide recommends precise tools with clear invocation conditions.
- Adding an agent touches its definition and one literal, never the tool or the prompt's flow.

## Consequences

- Sessions are per agent: "landing-page" on Claude and on another agent are separate.
- The prompt tells the model to use `claude` when installed, otherwise the first available agent, unless the user names another.
