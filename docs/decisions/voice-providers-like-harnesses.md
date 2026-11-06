# Voice providers like harnesses

Status: accepted, 2026-11-06

## Context

Bomby talked only through Gemini Live. Rime's Prism is a second speech-to-speech model with a LiveKit plugin ([LiveKit's Prism page](https://docs.livekit.io/agents/models/realtime/rime.md)), and more will follow. The user brings the key for whichever they pick, as with Gemini ([decision](users-bring-their-own-keys-and-claude.md)). Each LiveKit plugin builds its model differently and brings different extras: Gemini has Google Search on Google's side, and Prism accepts function tools only.

## Decision

- Each voice model is one `VoiceProvider` definition in `agent/voice_providers/` (`gemini.py`, `rime.py`), listed in `PROVIDERS`, the way harnesses are ([decision](one-tool-for-every-agent.md)). A definition holds its id, its name, the variable its key comes in, its voices and default voice, the voice variable for console runs, its options, the realtime model it builds and the tools it adds.
- The app names the provider for each call, with its voice and options (`provider`, `voice`, `provider_options` in the job's metadata). No provider means Gemini, which every call before the choice used. One Bomby doesn't have fails the call at start.
- **Options are a provider's own switches**, by id with a default: Gemini's `google_search` (on). The app sends what the user set, and the provider fills in the rest and ignores ids it doesn't have. An option adds to the prompt only when the model needs telling; Google Search needs nothing (owner, 2026-11-06).
- **Prompts are per provider** (`agent/prompts/<provider>/`), each written for how its model behaves, since we can't know that in advance (owner, 2026-11-06). Gemini keeps its Markdown prompts as they were; Rime's are the same tones in plain sentences, because Prism speaks in the style it reads ([notes](../rime-notes.md#prompting)). A provider's `prompt_style` (`agent/sections.py`) also sets how everything else that reaches the model is written: the sections a call adds, agent ids, and lists like remembered facts in the prompt and `recall_about_user`'s results.
- **The agent's definitions are the one catalogue.** Settings and the splash need each provider's name, key variable, voices and options before any call, so `just agent providers` writes them to `app/src-tauri/voice-providers.json`, which the core embeds. It's committed, so builds never run Python for it, and `just agent check` fails when it's out of date (owner, 2026-11-06). The core keeps only what is the app's: the typed provider ids (a test checks them against the catalogue), the keychain field and setting each pick is saved in, and the copy the page shows (`app/src/features/voice/`, tested against the catalogue too).
- Everything else in a call is shared across providers: `start_task`, steering, memory, resume, the task board.

## Why

- The common shape of a provider shows up only once there are two. A definition per provider keeps each plugin's own settings in one place and leaves the rest of the call untouched.
- Options per provider, rather than one flat list, let a provider bring what only it has without others pretending to.

## Consequences

- **Memory works the same on every provider.** Saving follows LiveKit's own conversation events, which each realtime plugin emits alike (checked for Gemini and Prism: running and final user transcripts with the line's id and start time); only how facts read follows the provider's style. A new provider needs its plugin checked for the same events ([LiveKit notes](../livekit-notes.md)), and nothing else in `agent/memory.py`.
- Adding a provider means a definition, its three tone prompts, keeping its key from the coding agents (`APP_KEYS` in `agent/acp_client/runner.py`), `just agent providers`, and in the app a `VoiceProvider` variant with its keychain field (`voice.rs`, `credentials.rs`) and its copy and key page (`app/src/features/voice/providers.tsx`, `key-pages.ts`).
- A call that switches provider doesn't change mid-call: like the server, the pick applies from the next call.
