# Voice providers like harnesses

Status: accepted, 2026-11-06

## Context

Bomby talked only through Gemini Live. Rime's Prism is a second speech-to-speech model with a LiveKit plugin ([LiveKit's Prism page](https://docs.livekit.io/agents/models/realtime/rime.md)), and more will follow. The user brings the key for whichever they pick, as with Gemini ([decision](users-bring-their-own-keys-and-claude.md)). Each LiveKit plugin builds its model differently and brings different extras: Gemini has Google Search on Google's side, and Prism accepts function tools only.

## Decision

- Each voice model is one `VoiceProvider` definition in `agent/voice_providers/` (`gemini.py`, `rime.py`), listed in `PROVIDERS`, the way harnesses are ([decision](one-tool-for-every-agent.md)). A definition holds its id, the variable its key comes in, its default voice, the voice variable for console runs, its options, the realtime model it builds and the tools it adds.
- The app names the provider for each call, with its voice and options (`provider`, `voice`, `provider_options` in the job's metadata). No provider means Gemini, which every call before the choice used. One Bomby doesn't have fails the call at start.
- **Options are a provider's own switches**, by id with a default: Gemini's `google_search` (on). The app sends what the user set, and the provider fills in the rest and ignores ids it doesn't have. An option adds to the prompt only when the model needs telling; Google Search needs nothing (owner, 2026-11-06).
- **Prompts are per provider** (`agent/prompts/<provider>/`), each written for how its model behaves, since we can't know that in advance (owner, 2026-11-06). Gemini keeps its Markdown prompts as they were; Rime's are the same tones in plain sentences, because Prism speaks in the style it reads ([notes](../rime-notes.md#prompting)). A provider's `prompt_style` also sets how the sections a call adds are written.
- Everything else in a call is shared across providers: `start_task`, steering, memory, resume, the task board.

## Why

- The common shape of a provider shows up only once there are two. A definition per provider keeps each plugin's own settings in one place and leaves the rest of the call untouched.
- Options per provider, rather than one flat list, let a provider bring what only it has without others pretending to.

## Consequences

- Adding a provider means a definition, its three tone prompts, keeping its key from the coding agents (`APP_KEYS` in `agent/acp_client/runner.py`), and its key, voices and options in the app.
- A call that switches provider doesn't change mid-call: like the server, the pick applies from the next call.
