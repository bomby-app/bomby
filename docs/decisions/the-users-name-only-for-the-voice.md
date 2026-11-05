# The user's name, only for the voice

Status: accepted, 2026-11-05

## Context

Bomby greeted everyone the same way. Some users like to be called by name; others would rather not give one.

## Decision

- Settings has an Intro section, right after Setup, where the mascot asks "What would you like me to call you?". The name is optional, up to 50 characters, and kept in the `settings` table (`user_name`).
- It goes with every call in the job metadata. When it's set, Gemini's instructions get one short section, `## The user`: "You're talking to Sam. Address the user by their name when needed." (`the_user` in `agent/voice_prompt.py`). When it's empty, nothing mentions a name.
- The coding agents don't get it: their reports reach the user through the voice, which already knows the name.

## Why

- One plain, human line keeps the voice prompt's behaviour as it is (owner's wording, 2026-11-05).
- The line says "their": a name doesn't tell anyone how the user wants to be referred to.

## Consequences

- A change reaches the next call, like the voice.
