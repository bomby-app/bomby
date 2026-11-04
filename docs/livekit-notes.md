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

- `lk agent console` uses local mic and speakers without a LiveKit server; `--text` types instead. Console logging is DEBUG and has no `--log-level` flag. Jobs have empty metadata, so `BOMBY_PROJECT` and `BOMBY_FOLDERS` stand in.
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
- **Token fetch.** `useSession` fetches on mount, every `start()`, and after end/disconnect. A token source must only mint. The app uses `TokenSource.literal`, which never caches: `custom` and `endpoint` cache per fetch options, so the token fetched at `end()` would join the next call with the last call's metadata; `start()` opens the call row, then the source requests a read-only token for a new room.
- **End and failure.** Room `Disconnected` closes the call however it ended. `useAgentErrors` ends failed agent connections and exposes `agent.failureReasons` on the project page.
- **Transcripts.** `useSessionMessages` message ids change as interim/final streams merge. The app keys and upserts lines by `attributes["lk.segment_id"]` (`features/call/transcript.ts`), giving storage and Message Scroller a stable id. Typed chat uses `from` to assign user/agent roles; saved lines replay in `AgentChatTranscript`.
- **Agents UI registry.** Current configuration uses `https://livekit.com/ui/r/{name}.json`; installation instructions live in [frontend-notes.md](frontend-notes.md#agents-ui).

## Worker, echo and noise

- `AgentServer.num_idle_processes` defaults to CPU count in production and 0 in dev. Bomby sets 1. Its health server binds `127.0.0.1` on an ephemeral port rather than production's public 8081.
- **Bluetooth echo.** macOS made the Bluetooth headset its default input mid-call and LiveKit follows the default (`deviceId: { ideal: "default" }`); a headset whose mic is in use drops into headset mode, and that mic hears its own playback. On macOS, WebKit voice processing with Bluetooth output caused the agent to hear itself; Chrome worked, Safari/WebKit and Firefox did not. Wired input/output removed the echo, isolating the issue from React, LiveKit and agent code (owner tests, 2026-11-04).
- **Mitigation.** Keep LiveKit's stock capture settings (turning echo cancellation and the rest off did not help) and pin the published mic to its actual opened device with `room.switchActiveDevice("audioinput", deviceId, true)`, preventing system-default changes from switching to a headset mic. Device selection still works. Use wired output for now; native LiveKit Rust audio in the Tauri core is the fallback.

## Data to the frontend

- Participant attributes carry current state. `bomby.tasks` is set with `local_participant.set_attributes` and read through `useAgent().attributes`, which re-renders on changes. Total attribute limit: 64 KiB ([docs](https://docs.livekit.io/transport/data/state/participant-attributes)).
- Text streams suit event messages, RPC request-response, and attributes or room metadata shared state ([docs](https://docs.livekit.io/transport/data/)).
