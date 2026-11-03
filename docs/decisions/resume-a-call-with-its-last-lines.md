# Resume a call with its last lines

Status: accepted, 2026-11-04

## Context

A project collects calls, and the user wants to pick one up again later. LiveKit rooms and Gemini sessions don't outlive a call, and Claude's sessions close with it (roadmap step 4 is about resuming those).

## Decision

- **Resume** on a past call starts a new LiveKit room and Gemini session, but keeps the same call: the core reopens its row (`ended_at` back to null) and the new lines are saved into it.
- The agent is told the conversation so far: the core sends the call's last 50 lines in the dispatch metadata (`history`), and the agent appends them to its instructions under `## Previous conversation` (`agent/call_options.py`), with a note that the old Claude sessions are closed.
- The call screen shows the saved lines above the live ones.

## Why

- Simple and model-agnostic: no Gemini session resumption, no stored session handles.
- One call per thread of conversation keeps the sidebar tree readable.
- 50 lines is enough context for "where were we" and stays far under the 512 KiB metadata limit.

## Consequences

- Claude starts fresh on a resumed call; the agent passes on what Claude needs. Resuming Claude's own sessions stays roadmap step 4.
- Longer history needs a summary later, not a bigger window.
