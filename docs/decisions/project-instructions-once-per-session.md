# Project instructions, told once per session

Status: accepted, 2026-11-05

## Context

The voice agent and the coding agents knew a project only by its name and folders. The user had no way to say what the project is or how they work on it without repeating it on every call.

## Decision

- Each project has optional instructions, written in the New project dialog or Project settings, up to 5,000 characters (`projects.instructions`, `MAX_INSTRUCTIONS_LEN` in `projects.rs`).
- They go with every call in the job metadata. The voice model gets them in the `## Project` section of its instructions, which always names the project and its folders, so "the project" means the call's (`project_context` in `agent/voice_prompt.py`, owner, 2026-11-06); each coding agent session gets them under `## This project` in its briefing, framed as the user's description of the project (`briefing` in `agent/acp_client/runner.py`).
- They're told once: in the voice model's instructions at connect time, and in a session's briefing when it opens. Follow-ups, steering and queued tasks don't repeat them.
- Empty instructions leave no trace: no note in the briefing, and only the name and folders in the voice model's `## Project`.

## Why

- 5,000 characters is about 1,250 tokens of English: room for a good description, without crowding the voice prompt or the briefing (owner, 2026-11-05).
- Once per session is how the briefing already works, and the coding agents keep their context from task to task, so repeating it would only cost tokens.
- The same text serves both: the voice agent needs to know what's being worked on to hand off well, and the coding agents need it to do the work.

## Consequences

- An edit during a call reaches the next call. Gemini's instructions are final once it connects (the session setup in `agent/agent.py`), and open sessions are already briefed.
- The coding agents still read their own `CLAUDE.md` or `AGENTS.md`; the instructions add to them.
