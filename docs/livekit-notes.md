# LiveKit notes

Checked 2026-11-03/04 against `livekit-agents` 1.8.10, LiveKit CLI 2.18.8 and docs.livekit.io. Installed Python source is under `agent/.venv/lib/python3.13/site-packages/livekit/agents/`.

## 1.8.11

Bumped 2026-11-06 from 1.8.10, with `livekit-plugins-google` 1.8.11 and the `livekit` SDK 1.2.0 ([release notes](https://github.com/livekit/agents/releases/tag/livekit-agents%401.8.11)). What matters to Bomby:

- **Rime**: Prism speech-to-speech through the standard realtime interface (`livekit-plugins-rime[realtime]` 1.8.11, which requires `livekit-agents>=1.8.11`).
- **GPT-Live**: OpenAI's full-duplex model, a `llm.DuplexModel` that `AgentSession` runs through `DuplexRealtimeAdapter`; the engine is in `livekit-agents` itself (`llm/_realtime/gpt_live.py`), and `livekit-plugins-openai` 1.8.11 adds OpenAI's provider tools ([notes](openai-notes.md)).
- **Realtime history and reconnection**: the Google plugin starts a fresh session after a config change instead of resuming the old one, and on 3.x models replays tool calls and results into the new session's history (`plugins/google/realtime/realtime_api.py`, diffed against 1.8.10). Nothing Bomby sets changed.
- **Uninterruptible speech** now keeps the user's transcript without interrupting or replying. Bomby never makes speech uninterruptible.
- Worker resources close when startup fails before `run()` completes.

## Async tools

- A `@function_tool` becomes non-blocking on its first `await ctx.update(msg)`. Its final return arrives when the agent is idle through synthetic call id `{call_id}_final` (`voice/tool_executor.py`).
- `ctx.update(msg, silent=True)` (1.8.9+) records progress without speech.
- `flags=ToolFlag.CANCELLABLE` exposes `lk_agents_get_running_tasks` and `lk_agents_cancel_task`; cancellation raises `asyncio.CancelledError`. Interrupting speech does not cancel work.
- `on_duplicate`: `allow` (default), `reject`, `replace`, `confirm`, matched by tool name.
- `ctx.foreground()` pauses the session for an interactive step, the future hook for voice permission prompts.
- Interrupted-turn tool output gets `reply_required=False` (`voice/generation.py`), which Gemini turns into `scheduling: SILENT` ([Gemini notes](gemini-notes.md)).
- [Async tool docs](https://docs.livekit.io/agents/logic/tools/async/).

## Running the agent

- `lk agent console` uses local mic and speakers without a LiveKit server; `--text` types instead. Console logging is DEBUG and has no `--log-level` flag. Jobs have empty metadata, so `BOMBY_PROJECT`, `BOMBY_FOLDERS`, `BOMBY_INSTRUCTIONS` and `BOMBY_USER_NAME` stand in.
- `lk agent dev` uses the CLI's selected project (`lk project list`), overriding `LIVEKIT_*` in `agent/.env`. `uv run python agent.py dev` uses `.env`; `just web-test` uses that path.
- `python agent.py console` is deprecated in favor of `lk agent console`.

## Dispatch and metadata

- A named agent (`@server.rtc_session(agent_name=...)`) joins only through explicit dispatch by API or participant token (`RoomConfiguration.agents` with `RoomAgentDispatch`).
- `ctx.job.metadata` is a JSON string by convention, up to 512 KiB.
- [Dispatch docs](https://docs.livekit.io/agents/server/agent-dispatch/).

## How the app makes a call

Also checked against `livekit-api` 0.10.0, `livekit-token` 0.4.0, `livekit-protocol` 0.8.2, `@livekit/components-react` 2.9.24 and `livekit-client` 2.23.0.

- **Worker.** `agent.py` registers `bomby`. The core waits for `registered worker` before minting the first token.
- **Token.** `src-tauri/src/calls.rs` uses `AccessToken` grants plus `RoomConfiguration { agents: [RoomAgentDispatch { agent_name: "bomby", metadata }] }`. Build `livekit-api` with `default-features = false, features = ["access-token"]` to omit HTTP/TLS.
- **Session.** Following `agent-starter-react` at `9e1fc2f`, one `useSession` lives in `call-provider.tsx`; the click calls `session.start()`, and the control bar ends it. Starting from an effect breaks under StrictMode and can leave the mic unpublished.
- **Start waits for the agent.** In `@livekit/components-react` 2.9.24, `useSession().start()` connects, then, when the token dispatches an agent, waits for it with `useAgent().waitUntilConnected(signal)`, which has no timeout of its own (`dist/room-*.mjs`). The agent's 30 s timeout only marks it `failed`; the start stays pending. So `start` gets an `AbortController` signal, aborted on the room's disconnect (`call-provider.tsx`); aborting also disconnects the room.
- **Token fetch.** `useSession` fetches on mount, every `start()`, and after end/disconnect. A token source must only mint. The app uses `TokenSource.literal`, which never caches: `custom` and `endpoint` cache per fetch options, so the token fetched at `end()` would join the next call with the last call's metadata; `start()` opens the call row, then the source requests a read-only token for a new room.
- **End and failure.** Room `Disconnected` closes the call however it ended. `useAgentErrors` ends failed agent connections and exposes `agent.failureReasons` on the project page.
- **Transcripts.** `useSessionMessages` message ids change as interim/final streams merge. The app keys and upserts lines by `attributes["lk.segment_id"]` (`features/call/transcript.ts`), giving storage and Message Scroller a stable id. Typed chat uses `from` to assign user/agent roles; saved lines replay in `AgentChatTranscript`.
- **Agents UI registry.** Current configuration uses `https://livekit.com/ui/r/{name}.json`; installation instructions live in [frontend-notes.md](frontend-notes.md#agents-ui).

## Worker, echo and noise

- `AgentServer.num_idle_processes` defaults to CPU count in production and 0 in dev. Bomby sets 1. Its health server binds `127.0.0.1` on an ephemeral port rather than production's public 8081.
- **Krisp noise cancellation runs in the agent, not on LiveKit Cloud** (`livekit-plugins-noise-cancellation` 0.3.2; docs.livekit.io/transport/media/noise-cancellation). Cloud only licenses and meters it: the wheel carries the Krisp library and models (73 MB for arm64; `NC()` needs 19 MB of it), loaded into the agent's process, and works only when the call is on LiveKit Cloud. The only server-side noise cancellation is at Cloud's SIP trunks, for phone calls. The plugin is proprietary (LiveKit's terms of service) and ad-hoc signed, so the hardened, signed agent can't load a downloaded copy without `disable-library-validation`. Bomby doesn't use it (owner, 2026-11-05); WebRTC's own noise suppression runs in the webview.
- **Bluetooth echo.** macOS made the Bluetooth headset its default input mid-call and LiveKit follows the default (`deviceId: { ideal: "default" }`); a headset whose mic is in use drops into headset mode, and that mic hears its own playback. On macOS, WebKit voice processing with Bluetooth output caused the agent to hear itself; Chrome worked, Safari/WebKit and Firefox did not. Wired input/output removed the echo, isolating the issue from React, LiveKit and agent code (owner tests, 2026-11-04).
- **Mitigation.** Keep LiveKit's stock capture settings (turning echo cancellation and the rest off did not help) and pin the published mic to its actual opened device with `room.switchActiveDevice("audioinput", deviceId, true)`, preventing system-default changes from switching to a headset mic. Device selection still works. Use wired output for now; native LiveKit Rust audio in the Tauri core is the fallback.

## The bundled server

Checked 2026-11-05 against `livekit/livekit` v1.13.10 and v1.13.11 (source and release assets), `livekit/mediatransportutil` `pkg/rtcconfig/`, and Homebrew's `Formula/l/livekit.rb`. Why Bomby ships it: [decision](decisions/livekit-on-this-mac-or-cloud.md).

- **Apache-2.0.** The app ships its LICENSE as `Resources/licenses/livekit-server.txt`.
- **No macOS release binaries**: `.goreleaser.yaml` builds `goos: linux, windows`. Homebrew builds from the tag's tarball with `go build ./cmd/server`. `go.mod` needs Go 1.26.0 and has `replace` lines (LiveKit's pion forks), so `go install ...@version` refuses it.
- **cgo on.** With `CGO_ENABLED=0`, darwin fails in `protocol/utils/hwstats` (`undefined: cpu.Get`). With cgo the binary links only libSystem, libresolv, CoreFoundation and Security. v1.13.10 on arm64, `-trimpath -ldflags "-s -w"`: 54 MB, 17.6 MB gzipped; builds in about 10 s warm (`just livekit build`).
- **Single node without Redis.** No `redis:` block runs everything in one process.
- **Config through the environment.** `LIVEKIT_CONFIG` is the YAML (`--config-body`), `LIVEKIT_KEYS` the `key: secret` lines (`--keys`) (`cmd/server/main.go`). Outside `--dev` a secret under 32 characters fails `ValidateKeys`. `--dev` falls back to `devkey`/`secret`, debug logs and `/debug/pprof`.
- **Ports.** Signal and API on `port` (7880), bound to `bind_addresses`. ICE over TCP on `rtc.tcp_port` (7881). ICE over UDP on a range (50000-60000), or one `rtc.udp_port` mux. `GET /` answers `OK` once it's serving.
- **Which address it advertises.** Without `rtc.node_ip`, IP discovery picks the first non-loopback address and uses loopback only when there is no other (`determineIP`, `GetLocalIPAddresses` in `ip.go`). `node_ip` becomes the NAT 1:1 address of every host candidate, and `enable_loopback_candidate` and `ips.includes` decide what's gathered (`webrtc_config.go`).
- **Stopping.** SIGTERM logs `exit requested, shutting down` and exits in about 40 ms, also after a request. Sent within about 10 ms of `starting LiveKit server`, it never exits (waited 15 s; 1.13.10). The core sends SIGKILL after 1 s; the server keeps nothing on disk.
- **Token dispatch works** on the open-source server: `RoomConfiguration.agents` from the token is handled in `pkg/service/roomallocator.go`, tested in `test/agent_test.go`.

## The conversation, for memory

Checked 2026-11-06 against `livekit-agents` 1.8.10 (`voice/agent_activity.py`, `voice/agent_session.py`, `ipc/job_proc_lazy_main.py`) and `livekit-plugins-google` 1.8.10 (`realtime/realtime_api.py`); Rime's plugin 1.8.11 sends the same ([notes](rime-notes.md#the-plugin)). A new voice provider's plugin must too: running and final `input_audio_transcription_completed` events with the line's `item_id` and `turn_started_at`. What `agent/memory.py` builds on:

- **Every line is a `conversation_item_added`**: the user's spoken ones (`_on_input_audio_transcription_completed`), typed ones (`_realtime_reply_task`, with `user_input`) and Bomby's (`_create_assistant_message`, `interrupted` set when cut off). `on_user_turn_completed` never fires with Gemini's server-side turn detection.
- **Gemini finalises the user's line late**: the final transcript comes when the reply's generation is done (`_mark_current_generation_done`), so it can arrive after the reply it prompted. LiveKit stamps the user's item with when the turn started (`created_at = turn_started_at`) and Bomby's with when it started speaking, so ordering by `created_at` puts them right.
- **Interim transcripts** (`user_input_transcribed`, `is_final=False`) grow with the turn and carry the item's id (`input_id`); an empty one marks speech stopping, right before the final.
- **Hang-up**: the job's shutdown callbacks run side by side (`asyncio.gather`), the session's own close among them, within `shutdown_process_timeout` (10 s). The session interrupts Bomby (an `interrupted` item), then emits `close`; a line the user hadn't finished never gets a final transcript.
- **`ctx.connect()` returns at once once connected**, so the entrypoint can connect while it reads memory, and `session.start` doesn't connect again.

## Data to the frontend

- Participant attributes carry current state. `bomby.tasks` (the call's tasks) and `bomby.memory` (`unavailable` when the call has no memory because Zep can't be reached) are set with `local_participant.set_attributes` and read through `useAgent().attributes`, which re-renders on changes. Total attribute limit: 64 KiB ([docs](https://docs.livekit.io/transport/data/state/participant-attributes)).
- Text streams suit event messages, RPC request-response, and attributes or room metadata shared state ([docs](https://docs.livekit.io/transport/data/)).

## RPC

Checked 2026-11-08 against the installed `livekit` SDK 1.2.0 (`livekit/rtc/participant.py`, `rpc.py`), `livekit-client` 2.23.0 (`dist/livekit-client.esm.mjs`, `dist/src/room/rpc/utils.d.ts`) and the bundled `livekit-server` 1.13.10. Extensions use it to reach the app's page ([decision](decisions/extensions.md)).

- **Agent side.** `room.local_participant.perform_rpc(destination_identity=, method=, payload=, response_timeout=None)` returns the answer's string or raises `rtc.RpcError` (`.code`, `.message`, `.data`). The page's identity is `user` (the token, `calls.rs`).
- **Page side.** `room.registerRpcMethod(method, async (data) => string)`, with `data.callerIdentity`, `data.payload` and `data.responseTimeout`; registering a method twice throws, so `unregisterRpcMethod` first. A thrown `RpcError(code, message)` reaches the caller with its message intact (at most 256 bytes); any other error arrives as 1500, "Application Error".
- **Codes.** 1400 the page has no handler for the method, 1401 no such participant, 1402 or 1504 a payload too large, 1403 a server older than 1.8.0, 1500 the handler failed, 1501 no acknowledgement in time, 1502 no answer in time, 1503 the page left. Codes 1001 to 1999 are LiveKit's; Bomby's own refusal is 2000.
- **Acknowledged before it runs.** The page acknowledges a request as it arrives, then runs the handler and sends its answer (livekit-client `RpcServerManager.handleIncomingRpcRequest`). After 1400, 1401, 1402, 1403, 1404 or 1505 (send failed) the handler never ran; after a timeout (1501, 1502), the page leaving (1503) or 1500 it may have, so a change may have been made (`NOT_RUN` in `agent/extensions/bridge.py`).
- **Timing.** The page must acknowledge within 7 s and answer within 15 s by default; the JavaScript client never waits less than 8 s.
- **Size.** 15 KiB (15,360 bytes) each way with the v1 protocol. livekit-client 2.23 also has a v2 over data streams with no limit, used only when the other side advertises it (`CLIENT_PROTOCOL_DATA_STREAM_RPC`); Bomby doesn't rely on it.

## Tools are fixed for a call

- LiveKit Agents 1.8.11 has no skills or on-demand tool loading (nothing named so in the installed package).
- `Agent.update_tools(tools)` changes a running agent's tools, but each realtime plugin applies it its own way: Gemini's marks its Live session to restart (`_mark_restart_needed` in `plugins/google/realtime/realtime_api.py`), Rime's reapplies its settings, GPT-Live's adapter updates the duplex session. A restart mid-call would be heard, so Bomby gives every tool when the session connects.
- `llm.Toolset(id=, tools=[...])` groups tools; the session flattens it. Optional arguments (`str | None = None`) reach Gemini as `nullable` (`plugins/google/utils.py`).
