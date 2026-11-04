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
- `lk agent dev` runs it against a LiveKit server (`LIVEKIT_*` in `agent/.env`) with hot reload. `python agent.py console` is deprecated in favor of `lk agent console`.
- Console jobs have empty metadata; `CLAUDE_PROJECT` and `CLAUDE_FOLDERS` stand in.

## Dispatch and job metadata

- Explicit dispatch: name the agent (`@server.rtc_session(agent_name=...)`) and dispatch it by API or in the participant token (`RoomConfiguration.agents` with `RoomAgentDispatch`). An agent with a name is only assigned to rooms when explicitly dispatched.
- Job metadata is a string, up to 512 KiB, JSON by convention; the agent reads it as `ctx.job.metadata`.
- Docs: https://docs.livekit.io/agents/server/agent-dispatch/

## Data to the frontend

- Text streams (guaranteed, topic-routed) suit event messages such as Claude status; RPC suits request-response; participant attributes and room metadata suit shared state.
- Docs: https://docs.livekit.io/transport/data/

## Frontend components

- Agents UI is LiveKit's shadcn component library for agent frontends (session view, chat transcript, control bar, audio visualizers), installed with `npx shadcn@latest add @agents-ui/<component>`.
- The official `agent-starter-react` uses it on Next.js; a desktop app can't run Next's server routes, so the app uses the components in a Vite React frontend.
- Docs: https://docs.livekit.io/frontends/components/agents-ui/, https://github.com/livekit-examples/agent-starter-react
