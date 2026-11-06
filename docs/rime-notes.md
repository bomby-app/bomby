# Rime notes

Checked 2026-11-06 against `livekit-plugins-rime` 1.8.11 and `rimelabs-sdk` 0.1.0a29 (installed source under `agent/.venv/lib/python3.13/site-packages/livekit/plugins/rime/realtime/` and `rimelabs_sdk/realtime/`), [LiveKit's Prism page](https://docs.livekit.io/agents/models/realtime/rime.md) and [Rime's Prism docs](https://docs.rime.ai/docs/prism/overview).

## The plugin

- `livekit.plugins.rime.realtime.RealtimeModel`, from the `realtime` extra (Python 3.11+, `livekit-agents>=1.8.11`). It makes its `rimelabs_sdk.Rime()` client when built, which reads `RIME_API_KEY` and raises `RimeAuthenticationError` without one, so a call with no key fails at start. One model per `AgentSession`; concurrent sessions are unsupported.
- Capabilities (`realtime_model.py`): server turn detection only (it can't be turned off), user transcription, audio output only, mutable instructions, tools and chat context. `tool_choice` is `auto` or `none`; per-reply `tools` are ignored; video frames are dropped.
- **Non-blocking tools**: its history sync knows LiveKit's non-blocking calls (`__livekit_agents_tool_non_blocking`) and deferred replies (`realtime/_history.py`), which `start_task` relies on. Not yet tried on a call.
- **Function tools only**: `_tool` raises "Prism accepts function tools only" for a provider tool such as Gemini's `GoogleSearch`.
- **Fillers**: Prism says a short line of its own before a tool runs ([tools](https://docs.rime.ai/docs/prism/tools.md)); `tool_fillers={name: PrismFiller(type="none" | "text" | "auto")}` sets it per tool. Bomby gives `start_task` none (`agent/voice_providers/rime.py`).
- **Playback**: with `playback="auto"` the plugin measures what the user heard only through its audio output wrapper. LiveKit's page says to call `model.wrap_audio_output()` in `on_enter`; 1.8.11 has only the private `_wrap_audio_output(output)`, so Bomby uses Prism's estimates.
- `generate_reply(instructions=...)` sends a nudge, so `on_enter` greets as with Gemini.
- **Dependencies**: `rimelabs-sdk` is an alpha and caps `websockets` below 17, so uv resolved 16.1.1 (`google-genai` allows up to 18). It brings `grpcio` and `rime-api`. All are in the frozen agent's `PYZ.pyz` (checked 2026-11-06).

## Prism

- English only. Audio is PCM16, 16 kHz in and 24 kHz out; the plugin converts.
- **Voices** ([sessions](https://docs.rime.ai/docs/prism/sessions.md#choose-a-voice)), Prism's own, not Rime's TTS voices; `astra` without one. Bomby defaults to `aurora` (owner).

  | Voice | How it sounds |
  | --- | --- |
  | `aurora` | Calm and lower-pitched, with a casual, natural delivery |
  | `wawona` | Bright and higher-pitched, with a polished, measured delivery |
  | `brando` | Low and steady, with a confident, conversational tone |
  | `astra` | Clear and youthful, with an energetic delivery |

- **Limits** ([errors](https://docs.rime.ai/docs/prism/errors.md#limits)): the conversation closes after 5 minutes idle (`session.idle_timeout`, then close code 1000 `idle`), even while audio streams; any other client event, such as a nudge, resets it. A dropped connection doesn't resume. A turn ends after 55 s of speech. Context is 65,536 tokens, oldest turns left out past it.
- **Bomby's keep-alive**: a quiet wait on a long task can pass 5 minutes, so every 4 minutes a Rime call sets the labels later replies carry (`model.update_options(response_metadata=...)`, a `session.update` that changes nothing else; `keep_alive` in `agent/voice_providers/rime.py`). Not yet tried past 5 minutes on a call.

## Prompting

- [Prism prompting](https://docs.rime.ai/docs/prism/prompting.md): everything Prism writes is spoken; its replies follow the style of its instructions, so headings and bullets there come back; say when to call each tool; start short. Rime's [text prompting guide](https://docs.rime.ai/docs/prompting.md) is for its TTS models (Coda, Mist), and `spell()` is theirs, not Prism's.
- Bomby's Rime prompts (`agent/prompts/rime/`) are Gemini's tone prompts in plain sentences: no headings, no bullets, no code marks. The sections a call adds are plain too (`sections.PLAIN`), and a test checks nothing in a Rime prompt is Markdown.
