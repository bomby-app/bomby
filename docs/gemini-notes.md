# Gemini 3.8 Live notes

Findings from checking Google's Live API docs against `livekit-plugins-google` 1.8.10 and `agent/agent.py`.

Sources:

- [`gemini-capabilities-guide.md`](gemini-capabilities-guide.md) (Google Live API capabilities guide, downloaded)
- [Gemini 3.8 Live](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live) and [3.8 Live Extended Thinking](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live-extended-thinking) model pages
- [LiveKit Gemini plugin docs](https://docs.livekit.io/agents/models/realtime/plugins/gemini/) (has a Gemini 3.8 section)
- [LiveKit async tools](https://docs.livekit.io/agents/logic/tools/async/) (`ctx.update`, cancellation, duplicate handling)
- Plugin source: `agent/.venv/lib/python3.13/site-packages/livekit/plugins/google/realtime/realtime_api.py`

## Models

| `MODEL` env | Model                               | Use when                                         |
| ----------- | ----------------------------------- | ------------------------------------------------ |
| `fast`      | `gemini-3.8-live`                   | Default, low latency; the one we build on        |
| `thinking`  | `gemini-3.8-live-extended-thinking` | Experiments only, see caveat 1 and the model decision |

## Capability check

| Google docs (3.8)                                                                 | Plugin 1.8.10 / our agent                                                                | Status |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------ |
| 3.8 Live: `thinkingLevel` not supported, must be omitted                          | `thinking_config` is sent only for `MODEL=thinking`                                      | OK     |
| Extended Thinking: `thinkingLevel` = `low` / `medium` / `high` (no `minimal`), **required** | `THINKING_LEVEL` (default `low`); without it the server closes with 1007 "Thinking level must be specified for this model" | OK |
| 3.8 Live: async tools (`NON_BLOCKING`) by default, `BLOCKING` optional            | Plugin defaults `tool_behavior=NON_BLOCKING` for any model containing `3.8`              | OK     |
| Extended Thinking: `NON_BLOCKING` only, no blocking, no function scheduling       | `NON_BLOCKING` sent; outputs that need no reply are sent with `scheduling: SILENT`        | Broken, see caveat 1 |
| Extended Thinking: `turnComplete` does not mean idle, use `interaction_status`    | Plugin closes each output segment on `generation_complete`; does not read `interaction_status` | OK, see caveats |
| Proactive audio permanently enabled; `proactive_audio: false` errors              | We don't set `proactivity`                                                                | OK     |
| Affective dialog removed from the API                                             | We don't set `enable_affective_dialog`                                                    | OK     |
| Audio-only response modality; use output transcription for text                   | Plugin default `["AUDIO"]`; input and output transcription enabled                       | OK     |
| Native audio models pick language automatically, no explicit language code        | We don't set `language`                                                                   | OK     |
| Audio sessions limited to 15 min without context window compression; connections last ~10 min | Plugin always requests resumption handles, but on `go_away` it closes and reconnects (its own TODO: "not seamless"). `context_window_compression` is off unless set | Open, see caveats |

## Caveats

1. **Extended Thinking crashes on silent tool responses (confirmed 2026-11-03).** Any tool output with `reply_required=False` makes the plugin send `scheduling: SILENT`, and Extended Thinking closes the session with a fatal `1007 Function response scheduling is not supported for this model`. It is not just `ctx.update(silent=True)`: LiveKit marks the output of any tool called in an interrupted turn as needing no reply. Seen in console when Gemini interrupted itself while calling `lk_agents_get_running_tasks`. Also reported on Google's forum ("gemini-3.8-live: 1011/1008 session drops...", section 4). That test also never voiced Claude's result. Hence [the model decision](decisions/gemini-3-8-live-not-extended-thinking.md).
2. **`interaction_status` is not read by the plugin.** It relies on `generation_complete` per segment instead. This matches LiveKit's claim that the plugin handles the async turn lifecycle, but it is unverified until a live console run.
3. **Don't set `proactivity` or `enable_affective_dialog`.** Besides the errors above, setting either makes the plugin switch to API version `v1alpha`, while Google's docs use `v1beta`.
4. **Thoughts appear in transcripts.** The LiveKit docs say thoughts are forwarded like other transcripts by default. Disable with `thinking_config=types.ThinkingConfig(include_thoughts=False)`. Unverified whether `gemini-3.8-live` accepts a `thinking_config` that has no `thinking_level`, so test it on that model before relying on it.
5. **Thinking depth.** Extended Thinking requires a level: set `THINKING_LEVEL` to `low` (default), `medium` or `high`. `agent.py` sends it only when `MODEL=thinking`, never to `gemini-3.8-live`.
6. **Long calls are not handled yet.** A call past ~10 minutes hits a Gemini reconnect, and past 15 minutes the session cap (no compression is set). Whether a background tool result survives a reconnect is untested. Deliberately out of scope until long-session handling is designed.

## Expected behavior

- Proactive audio means the model may stay silent on input it judges irrelevant (background speech, noise). Address it directly if it doesn't respond.
- On Extended Thinking, expect spoken progress updates while it works and longer time to the tool call. Per the LiveKit demo, the server sends `turnComplete` after each progress segment, then more audio, then the tool call.

## Voices

Checked 2026-11-04.

- Live (native audio) takes any TTS voice by name (`speech_config.voice_config.prebuilt_voice_config.voice_name`; the plugin's `RealtimeModel(voice=...)`). The app offers Gemini's 30 prebuilt voices, with style and pitch from the speech generation docs and AI Studio (`app/src-tauri/src/settings.rs`); Charon is the default.
- `GET /v1beta/voices` (`x-goog-api-key`, `page_size` up to 1000) lists far more: the user's own designed voices (`type: "prompted"`, ids like `voice_...`) first, then a catalog of about a thousand prebuilt voices per page (ids like `achernar` or `ar-001-advisor-1`, with `language_code`, `accent`, `gender`, `pitch`, `persona`, `description`) and a `next_page_token`. The owner chose the 30 default voices only; whether Live accepts catalog or custom ids is unchecked.

## Language

- Native-audio Live models choose their spoken language themselves and take no language code (Live API capabilities, "Change voice and language"); "you can restrict the languages it speaks in by specifying it in the system instructions". `prompts/voice.md` holds the agent to English unless the user switches.
- Input transcription takes `AudioTranscriptionConfig(language_codes=[...])` as BCP-47 hints (google-genai types). `agent.py` passes `["en-US"]`: noisy audio had been transcribed as Portuguese and answered in Russian (2026-11-04).
- **The user's transcript arrives with the reply.** The plugin forwards each `input_transcription` chunk the moment Gemini sends it (`realtime_api.py`, `_is_new_generation` starts a generation for it), but Gemini sends it around the start of its answer, so the user's line shows with the agent's turn. LiveKit's docs: realtime models give no interim results and user transcripts "often arrive after the agent's response"; their fix is a separate STT, which `agent_activity.py` only uses for the transcript when the realtime model has no user transcription of its own (`on_interim_transcript`). Checked in `livekit-agents` 1.8.10 and docs.livekit.io `agents/models/realtime`, 2026-11-04. The owner chose no separate model: the delay stays.
