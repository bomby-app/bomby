# LiveKit notes

Checked against `livekit-agents` 1.8.10 (`agent/.venv/lib/python3.13/site-packages/livekit/agents/`), the LiveKit CLI 2.18.8 and docs.livekit.io, 2026-11-03.

## Async tools (livekit-agents 1.6+)

- A `@function_tool` becomes non-blocking on its first `await ctx.update(msg)`. Its final `return` is delivered as the tool result once the agent is idle, through a synthetic call id `{call_id}_final` and an instruction to summarize it (`voice/tool_executor.py`).
- `ctx.update(msg, silent=True)` (1.8.9+) records progress without a spoken reply.
- `flags=ToolFlag.CANCELLABLE` auto-exposes `lk_agents_get_running_tasks` and `lk_agents_cancel_task`; cancel raises `asyncio.CancelledError` in the tool. Interrupting speech is not cancelling.
- `on_duplicate`: `allow` (default), `reject`, `replace`, `confirm`, matched by tool name.
- `ctx.foreground()` pauses the session for an interactive step: the future hook for voice permission prompts.
- A tool output from an interrupted turn gets `reply_required=False` (`voice/generation.py`, `_interrupted_tool_output`). On Gemini that becomes `scheduling: SILENT`; see [gemini-notes.md](gemini-notes.md).
- Docs: https://docs.livekit.io/agents/logic/tools/async/

## Running the agent

- `lk agent console` runs the agent locally against the mic and speakers, no LiveKit server needed. It has no `--log-level` flag: the Python side logs at DEBUG in this mode (hardcoded in `cli/cli.py`). `--text` types instead of talking.
- `lk agent dev` runs it against a LiveKit server with hot reload, but on the `lk` CLI's selected project (`lk project list`, the `*` row), which overrides `LIVEKIT_*` in `agent/.env` (seen 2026-11-04: "Using project [avatar]" while `.env` pointed at another project, so dispatches from that project never reached it). `uv run python agent.py dev` uses `agent/.env`; `just web-test` runs it that way. `python agent.py console` is deprecated in favor of `lk agent console`.
- Console jobs have empty metadata; `CLAUDE_PROJECT` and `CLAUDE_FOLDERS` stand in.

## Dispatch and job metadata

- Explicit dispatch: name the agent (`@server.rtc_session(agent_name=...)`) and dispatch it by API or in the participant token (`RoomConfiguration.agents` with `RoomAgentDispatch`). An agent with a name is only assigned to rooms when explicitly dispatched.
- Job metadata is a string, up to 512 KiB, JSON by convention; the agent reads it as `ctx.job.metadata`.
- Docs: https://docs.livekit.io/agents/server/agent-dispatch/

## How the app makes a call

Checked 2026-11-04 against `livekit-agents` 1.8.10, `livekit-api` 0.10.0 (token code in `livekit-token` 0.4.0, protocol types in `livekit-protocol` 0.8.2), `@livekit/components-react` 2.9.24 and `livekit-client` 2.23.0.

- **Explicit dispatch.** `agent.py` registers as `@server.rtc_session(agent_name="claudible")`, so rooms only get the agent when a token asks for it. The worker logs `registered worker` once LiveKit accepts it (`worker.py`, `_handle_register`); the core waits for that line before handing out the first token.
- **The token** (Rust, `src-tauri/src/calls.rs`): `AccessToken::with_api_key(..).with_grants(VideoGrants { room_join, room, can_publish, can_subscribe, can_publish_data, .. }).with_room_config(RoomConfiguration { agents: vec![RoomAgentDispatch { agent_name: "claudible", metadata }] })`. `metadata` is the project JSON the agent reads as `ctx.job.metadata`. Use `livekit_api::access_token` (the documented path); `RoomConfiguration` comes from `livekit_protocol`. Build `livekit-api` with `default-features = false, features = ["access-token"]` to skip the HTTP and TLS stack.
- **Joining** (React), as LiveKit's agent starter (`livekit-examples/agent-starter-react` at `9e1fc2f`) and the owner's almarai app do it: one `useSession(tokenSource, options)` at the top (`features/call/call-provider.tsx`), `session.start()` from the click, and leaving is `AgentControlBar`'s `onDisconnect={session.end}`. `start()` with no options enables the mic with `preConnectBuffer: true`. Don't start a session from a React effect: dev StrictMode runs effects twice, and connect, abort, connect left the mic unpublished (2026-11-04). `useAgent(session).state` is one of `connecting`, `pre-connect-buffering`, `initializing`, `idle`, `listening`, `thinking`, `speaking`, `failed`, `disconnected`.
- **The session fetches tokens on its own** (`useSession.ts`): once on mount (`prepareConnection`), on each `start()`, and with `force` on `end()` and on any disconnect not caused by `end()`, so a fresh room is ready for the next start. So a token source must only mint. Ours did more (it opened a call row in the core), and one End call opened two empty calls and switched the screen to a dead one (2026-11-04). `AgentDisconnectButton` calls the control bar's `onDisconnect`, then `end()` itself, so `end()` runs twice per click in the starter too; harmless.
- **Token sources** (`livekit-client` `TokenSource.ts`): `TokenSource.literal(fn)` calls `fn` on every fetch, no cache. `TokenSource.custom` and `TokenSource.endpoint` cache the answer per fetch options (`agentName`, `agentMetadata`, room and participant fields) and refetch on `force` or an expired token, so the token fetched at `end()` would serve the next start unless the options change. The app uses `literal`: `start()` opens the call in the core (`open_call`), then the source asks the core for a token for it (`call_token`, read only, a new room each time). A call is closed on the room's `Disconnected` event, however it ends.
- **A failed agent** (it never joined within `agentConnectTimeoutMilliseconds`, or left): the starter's `useAgentErrors` shows `agent.failureReasons` and calls `end()`. The app does the same; the reasons show on the project's page.
- **Transcripts.** `useSessionMessages(session).messages` are `{ id, timestamp, type: "userTranscript" | "agentTranscript" | "chatMessage", message, from? }`; a line's `id` is not stable: each spoken segment arrives as an interim and then a final text stream sharing `lk.segment_id`, and `@livekit/components-core` (`textStream.ts`) merges them on that attribute but carries the latest stream's info, so the merged message's `id` changes as the line settles (docs: `agents/multimodality/text`, "These streams share the same `segment_id`... logging every message can produce duplicates"). The app keys lines on `attributes["lk.segment_id"]` (`features/call/transcript.ts`, `lineId`): saved once per segment (upsert by `(call, segment)`; keying on `id` had saved lines two or three times), and one stable row id in the live transcript, which shadcn's Message Scroller needs to follow the live edge ("Use stable `messageId` values"). Agents UI's `AgentChatTranscript` only reads `from.isLocal` to align user lines, which is how saved lines replay in the same component.
- **Agents UI's registry moved** to `https://livekit.com/ui/r/{name}.json` (`shadcn registry add @agents-ui` wrote that; the starter still lists `livekit.io`).

## Worker size, echo and noise

- **Warm processes.** `AgentServer`'s `num_idle_processes` defaults to the CPU count in production mode (`start`) and 0 in `dev` (`worker.py`, `_default_num_idle_processes`); on a 16-core Mac that is 17 Python processes. `agent.py` sets 1: one user, one call.
- **Health server.** In production mode the worker serves HTTP on `0.0.0.0:8081` (`_default_port`); a second worker on the same Mac fails to bind. `agent.py` passes `host="127.0.0.1", port=0`: local only, any free port.
- **Echo and input switching, 2026-11-04** (Shure mic on a Scarlett as macOS input, Sony XM4 over Bluetooth as output). The agent's own words came back as user lines, misheard and repeated, and Gemini answered them; macOS switched inputs mid-call with its volume overlay. `app.log` showed the cause: the call opened the Scarlett, then 33 s later re-opened the mic as the WH-1000XM4, because macOS had made the XM4 its default input and LiveKit follows the default (`deviceId: { ideal: "default" }`). A Bluetooth headset can't play high quality audio and record at once, so its mic in use drops it into headset mode, and that mic hears its own playback.
- **Same agent, LiveKit's agent starter in three browsers (`just web-test`):** fine in Chrome; the same switching and self-talk in Safari (WebKit, which Tauri uses on macOS) and Firefox. So it is the browser's audio stack on macOS, not React, LiveKit or the agent.
- **Narrowed down, 2026-11-04.** macOS's log (`log show`) during a call: WebKit's GPU process captures through Apple's voice processing, an aggregate of the chosen mic and the system output (`AUVPAggregate: input device -> Scarlett Solo USB; output device -> 88-C9-E8-39-39-C3:output`, the XM4). Owner's test: the Scarlett alone for input and output, XM4 disconnected, no echo; XM4 connected again (Teams and FluidVoice closed), echo back. So it is Bluetooth output under WebKit's echo cancellation, not our code. For now: wired output. If that's not acceptable later, the fallback below stands.
- **What the app does about it:** LiveKit's stock capture settings (as the owner's working LiveKit apps use; turning echo cancellation and the rest off did not help), and once the mic is published it is pinned to the real device it opened (`room.switchActiveDevice("audioinput", deviceId, true)`), so a mid-call change of the system default can't move it to the headset's mic. Picking a device in the control bar still works. If WebKit keeps flipping Bluetooth headphones into headset mode, the fallback is capturing and playing call audio natively in the Tauri core (LiveKit's Rust SDK), as Chrome effectively does.

## Data to the frontend

- Text streams (guaranteed, topic-routed) suit event messages such as Claude status; RPC suits request-response; participant attributes and room metadata suit shared state.
- Docs: https://docs.livekit.io/transport/data/

## Frontend components

- Agents UI is LiveKit's shadcn component library for agent frontends (session view, chat transcript, control bar, audio visualizers), installed with `npx shadcn@latest add @agents-ui/<component>`.
- The official `agent-starter-react` uses it on Next.js; a desktop app can't run Next's server routes, so the app uses the components in a Vite React frontend.
- Docs: https://docs.livekit.io/frontends/components/agents-ui/, https://github.com/livekit-examples/agent-starter-react
