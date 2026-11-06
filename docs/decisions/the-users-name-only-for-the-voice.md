# The user's name, only for the voice

Status: accepted, 2026-11-05; a voice provider's backend added 2026-11-07

## Context

Bomby greeted everyone the same way. Some users like to be called by name; others would rather not give one.

## Decision

- Settings has an Intro section, right after Setup, where the mascot asks "What would you like me to call you?". The name is optional, up to 50 characters, and kept in the `settings` table (`user_name`).
- It goes with every call in the job metadata. When it's set, the voice model's instructions get one short section, `## The user` (plain on the providers that read plain sentences): "You're talking to Sam. Address the user by their name when needed." (`the_user` in `agent/voice_prompt.py`). When it's empty, nothing mentions a name.
- The coding agents don't get it: their reports reach the user through the voice, which already knows the name.
- Nor does a voice provider's backend (GPT-Live's response model, `backend_instructions` in `agent/voice_prompt.py`), which writes the coding agents' tasks; it doesn't get what memory knows either. It can look a fact up with `recall_about_user` when a task needs one (owner's rule for the coding agents, applied 2026-11-07).

## Why

- One plain, human line keeps the voice prompt's behaviour as it is (owner's wording, 2026-11-05).
- The line says "their": a name doesn't tell anyone how the user wants to be referred to.

## Consequences

- A change reaches the next call, like the voice.
- With memory across calls on, the name is also the Zep user's first name in the user's own Zep project, so its facts name them ([decision](memory-across-calls-with-zep.md)). Still never the coding agents.
