# Tones as whole voice prompts

Status: accepted, 2026-11-05.

## Context

The owner wanted to choose how Bomby talks: Sharp, Chatty or Playful, in Settings, Bomby.

## Decision

- **One whole prompt per tone**: `agent/prompts/sharp.md` (the old `voice.md`), `chatty.md` and `playful.md`, now one set per voice provider in `agent/prompts/<provider>/` ([voice providers](voice-providers-like-harnesses.md)), each written top to bottom in its tone: Gemini Live talks the way its prompt is written, so a Tone section alone left Playful sounding Sharp (owner's test, 2026-11-05). Sharp is the original `voice.md`. All three share their sections and `## Non-negotiable rules` word for word.
- **Stored and sent like the name**: the `tone` setting goes in each call's metadata; `voice_prompt.py` picks the file. Sharp is the default, and an unknown tone falls back to it rather than failing the call.

## Consequences

- A change to what Bomby does is made in all three, each in its own voice; `test_every_tone_keeps_its_providers_rules_and_sections` keeps a provider's rules and sections the same across its tones.
- A new tone is a file, a `Tone` value in `settings.rs` and `call_options.py`, and a Select item.
