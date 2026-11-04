# Python agent on LiveKit and Gemini 3.8 Live

Status: Accepted, 2026-11-03

## Context

The voice side must keep talking while long background work runs, then speak the result. LiveKit Agents (1.6+) has async tools for exactly this, and Gemini 3.8 Live is a speech-to-speech model with non-blocking tools by default.

## Decision

Build the agent in Python on LiveKit Agents with `google.realtime.RealtimeModel` (Gemini 3.8 Live). Not agents-js: it loses background tool results on 3.8 (livekit/agents-js#2593).

## Consequences

- Everything Gemini gets (instructions, tools) is fixed at connect time; changing tools mid-call forces a reconnect.
- Long calls hit Gemini's reconnect and audio caps; handled later (see the roadmap).
