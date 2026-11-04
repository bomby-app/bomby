# The call's tasks reach the app as an attribute on the agent

Status: accepted, 2026-11-04

## Context

The app's agents panel lists what each agent is doing on the call. The roadmap planned status events over LiveKit text streams (step 2). The panel only needs the current state of a short list, not a history of events.

## Decision

- The voice agent keeps the call's latest 20 tasks (`agent/task_board.py`): agent, session, what it was asked (shortened), status (`working`, `added` to a running task, `done`, `failed`, `stopped`) and times.
- It publishes the whole list as one attribute on its own participant, `bomby.tasks` (JSON), whenever a task starts or ends. The page reads it with `useAgent().attributes` (`features/call/agents-panel.tsx`).
- The voice model still gets only the final result ([results-only-as-tool-results.md](results-only-as-tool-results.md)).

## Why

- An attribute is state: a page that joins late or reconnects gets the current list at once, with no replay. LiveKit already delivers changes (`ParticipantAttributesChanged`), and `useAgent()` re-renders on them.
- No new transport, no event ordering to get right.

## Consequences

- LiveKit allows 64 KiB of attributes in all; 20 tasks of 160 characters stay far below.
- Progress inside a task (tool calls, partial output) isn't shown; that would be a text stream later.
