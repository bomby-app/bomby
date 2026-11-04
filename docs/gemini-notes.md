# Gemini 3.8 Live notes

Checked 2026-11-03/04 against Google's Live API docs, `livekit-plugins-google` 1.8.10 and `agent/agent.py`.

Sources:

- [Live API capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities), [best practices](https://ai.google.dev/gemini-api/docs/live-api/best-practices) and [model pages](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live)
- [LiveKit Gemini plugin](https://docs.livekit.io/agents/models/realtime/plugins/gemini/) and [async tools](https://docs.livekit.io/agents/logic/tools/async/)
- Plugin source: `agent/.venv/lib/python3.13/site-packages/livekit/plugins/google/realtime/realtime_api.py`

## Models

| `MODEL` env | Model | Use |
| --- | --- | --- |
| `fast` | `gemini-3.8-live` | Default, low latency |
| `thinking` | `gemini-3.8-live-extended-thinking` | Experiments only; see caveats and [decision](decisions/gemini-3-8-live-not-extended-thinking.md) |

## Capability check

| Google docs | Plugin 1.8.10 / Bomby | Status |
| --- | --- | --- |
| 3.8 Live does not support `thinkingLevel` | Sent only for `MODEL=thinking` | OK |
| Extended Thinking requires `low`, `medium` or `high` | `THINKING_LEVEL`, default `low`; missing level closes with 1007 | OK |
| 3.8 Live defaults to async tools; blocking is optional | Plugin defaults to `NON_BLOCKING` for models containing `3.8` | OK |
| Extended Thinking is async-only and rejects function scheduling | Plugin sends `SILENT` for outputs needing no reply | Broken; caveat 1 |
| Extended Thinking requires `interaction_status`, not `turnComplete`, for idle | Plugin uses `generation_complete` per segment | Caveat 2 |
| Proactive audio is always enabled; affective dialog is removed | Neither option is set | OK |
| Audio-only output; use output transcription for text | `["AUDIO"]` with input/output transcription | OK |
| Native audio selects language automatically | No explicit output language | OK |
| Audio sessions cap at 15 min; connections reconnect around 10 min | Resumption handles requested, but reconnect is not seamless; compression off | Caveat 5 |

## Caveats

1. **Extended Thinking crashes on silent tool responses.** Any output with `reply_required=False`, including tools from interrupted turns, becomes `scheduling: SILENT`; Extended Thinking closes with fatal `1007 Function response scheduling is not supported for this model`. Confirmed 2026-11-03. Keep it experimental.
2. **`interaction_status` is unread.** The plugin relies on `generation_complete`; live behavior remains unverified.
3. **Do not set `proactivity` or `enable_affective_dialog`.** They also make the plugin use `v1alpha` rather than Google's documented `v1beta`.
4. **Thoughts enter transcripts by default.** `thinking_config=types.ThinkingConfig(include_thoughts=False)` may disable them, but 3.8 Live's acceptance of a config without `thinking_level` is untested.
5. **Long calls are unhandled.** Reconnects start around 10 minutes and audio caps at 15 without compression. Survival of background tool results across reconnect is untested; see [roadmap](roadmap.md).
6. **Proactive audio may ignore background speech or noise.** Address the model directly if it does not respond.

## Voices

- Live accepts TTS voice names through `RealtimeModel(voice=...)`. The app offers the 30 prebuilt voices in `app/src-tauri/src/settings.rs`; Charon is default.
- `GET /v1beta/voices` also lists custom and catalog voices with pagination. Whether Live accepts those ids is untested; Bomby deliberately uses the 30 defaults.

## Language

- Native-audio Live selects spoken language automatically; system instructions can restrict it. `prompts/voice.md` keeps English unless the user switches.
- `agent.py` passes input transcription hint `AudioTranscriptionConfig(language_codes=["en-US"])` after noisy audio produced incorrect transcripts.
- Gemini sends user transcription around the start of its answer, so the user's line appears with the agent's turn. LiveKit realtime models provide no interim user transcript; a separate STT would be needed to avoid the delay, and the owner chose not to add one.

## Prompting

- `prompts/voice.md` has the owner's sections: Role, Tone, How you work, Non-negotiable rules. Plain sentences that describe behaviour, positive phrasing, negative rules only for what models do by default, sentence case (owner, 2026-11-04: no shouting at a modern model).
- Google's best practices: persona first (name, role, character, language), then conversational rules in the order to follow them, tool calls each in their own sentence inside that flow, then guardrails with "if X happens, do Y" examples. Use "unmistakably" where the model must be precise. One prompt per persona, no multi-page prompts.
- Tool docstrings say when to invoke the tool, not only what it does. The Live API waits for the user before speaking, so `on_enter` prompts the greeting.

## Tool schemas

A one-value Python `Literal` becomes JSON Schema `const`; the Google plugin rewrites it to a one-value `enum`, which Gemini accepts. Multi-value literals become `enum` (`livekit/plugins/google/utils.py`).
