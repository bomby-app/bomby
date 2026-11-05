# LiveKit notes

Checked 2026-11-03/04 against `livekit-agents` 1.8.10, LiveKit CLI 2.18.8 and docs.livekit.io. Installed Python source is under `agent/.venv/lib/python3.13/site-packages/livekit/agents/`.

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
- **Krisp noise cancellation** (`livekit-plugins-noise-cancellation` 0.3.2, `plugin.py` in the installed source; docs.livekit.io/transport/media/noise-cancellation): `noise_cancellation.NC()` is an `rtc.NoiseCancellationOptions` for `room_io.AudioInputOptions(noise_cancellation=...)`, passed as `session.start(room_options=room_io.RoomOptions(audio_input=...))`. It works only through LiveKit Cloud, where background noise suppression (NC) is included on every plan; voice isolation (VIVA, `livekit-plugins-krisp`) is metered (100 minutes a month on Build). Bomby turns NC on when `is_cloud(LIVEKIT_URL)` (`livekit/agents/utils/misc.py`: `*.livekit.cloud`, `*.livekit.run`), in `agent/livekit_cloud.py`. Don't stack frontend Krisp on top; WebRTC's own suppression can stay on.
- **The plugin is proprietary and large.** Licensed under LiveKit's terms of service, not open source. The arm64 wheel is 73 MB: `liblivekit_nc_plugin.dylib` (12 MB) and three models (`nc` 6.6 MB; `bvc` and `bvct` 57 MB together, unused by `NC()`). `--collect-all livekit` freezes all of it: the agent folder went from 190 to 262 MB. `just agent sign` signs the dylib with the rest.
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

## Data to the frontend

- Participant attributes carry current state. `bomby.tasks` is set with `local_participant.set_attributes` and read through `useAgent().attributes`, which re-renders on changes. Total attribute limit: 64 KiB ([docs](https://docs.livekit.io/transport/data/state/participant-attributes)).
- Text streams suit event messages, RPC request-response, and attributes or room metadata shared state ([docs](https://docs.livekit.io/transport/data/)).
