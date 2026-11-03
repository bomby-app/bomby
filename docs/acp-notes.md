# ACP and claude-agent-acp notes

Checked against `claude-agent-acp` 0.100.0 (`dist/acp-agent.js` in the mise install, `~/.local/share/mise/installs/npm-agentclientprotocol-claude-agent-acp/0.100.0/`) and the Python SDK `agent-client-protocol` 0.12.1 (`agent/.venv/lib/python3.13/site-packages/acp/`), 2026-11-03. Read the source for behavior, not memory.

## Protocol

- The Python SDK speaks ACP v1 (`PROTOCOL_VERSION = 1`). The adapter's v2 is a draft; stay on v1.
- Client methods we use: `initialize`, `new_session`, `set_session_mode`, `prompt`, `cancel`, `close_session`, `ext_method`. Also available: `resume_session`, `load_session` (roadmap step 4).
- `spawn_agent_process(client, cmd, *args, env=, cwd=, transport_kwargs=)` starts the adapter. Its environment is `default_environment()` (only `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, `USER`) merged with `env`, so we pass the full filtered environment. `transport_kwargs={"limit": ...}` sets the read buffer per line; the SDK reassembles longer lines either way (`_transport.py`, `LimitOverrunError`), so the limit only saves round trips.
- The adapter's stderr is a pipe and must be drained, or it blocks. We log it at debug.
- Client methods we don't implement (fs, terminal, elicitation) return method-not-found; we advertise none of them, so Claude Code does its own file and shell work.

## Sessions

- `new_session(cwd, additional_directories=[...], mcp_servers=[], **meta)`: extra kwargs go into `_meta`. The adapter checks every directory is absolute.
- **System prompt append**: `systemPrompt={"append": "..."}` in `_meta`. A string replaces the prompt; an object uses the `claude_code` preset plus `append`.
- **Permissions**: new sessions start in the settings' `defaultMode`. Call `set_session_mode(session_id, "bypassPermissions")` after `new_session`. Bypass is not offered when running as root without a sandbox, when settings set `permissions.disableBypassPermissionsMode: "disable"`, or when `_meta.claudeCode.options.allowDangerouslySkipPermissions` is `false`; the runner then logs a warning and auto-approves permission requests instead.
- **Close**: the adapter advertises `sessionCapabilities.close` on v1, and closing ends a running turn as `cancelled`. The SDK's *agent* router keeps `session/close` behind `use_unstable_protocol`, so the fake agent sets it.
- Several prompts to one session are queued: each runs after the one before and answers when its own turn ends.

## Steering (mid-turn messages)

- Extension request `_session/steering`; the SDK's `ext_method("session/steering", params)` adds the leading underscore. Advertised in the initialize response's top-level `_meta.steering.supported`.
- Params: `{"sessionId", "prompt": [content blocks], "_meta": {"steering": {"idleBehavior": "promptRequired"}}}`.
- Turn running: the message is injected into it (`{"outcome": "injected"}`). It pre-empts the current generation or slots in between tool calls; a foreground tool call moves to the background. The turn settles only once a result answers the steer, so the original `prompt` call's response covers both.
- No turn running: with `idleBehavior: promptRequired` it returns `{"outcome": "promptRequired"}` and does nothing, so the client sends a normal prompt. Without it, the adapter starts a detached turn nobody waits on.

## Replies

- The SDK runs every incoming notification (`session/update`) as its own task, but resolves a request's response inline (`connection.py`, `_process_message`). The turn's last chunks are only collected before `prompt` returns because the client's `session_update` never awaits. Keep it that way: anything slow goes on a queue.
- When a steer pre-empts generation, the interrupted cycle ends and the steered message runs as another; the runner keeps only Claude's last message, so the appended system prompt asks Claude to make it cover the whole task.
- `AgentMessageChunk` carries `messageId`; chunks of one message share it. A new id or a `ToolCallStart` means the text so far was narration. The runner keeps only the last message.
- The adapter pushes `_auth/status_update` notifications with the account it runs as (logged at info).

## Billing

- Claude Code signs in with the user's Claude plan login. `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` in its environment would bill the API instead, so the runner strips them. It also strips `CLAUDECODE`, which Claude Code sets in its own shells and refuses to start under.

## Which claude it runs, and sign-in status

Checked in adapter 0.100.0 (`dist/acp-agent.js`), 2026-11-03.

- `claudeCliPath()` returns `CLAUDE_CODE_EXECUTABLE` when set, before looking for the SDK's bundled binary (`@anthropic-ai/claude-agent-sdk-<platform>/claude`, 305 MB on darwin-arm64). Session start passes it as `pathToClaudeCodeExecutable`. So a packaged adapter can run the user's own `claude`.
- After `initialize` the adapter probes the CLI's login in the background and pushes `_auth/status_update` (`{authStatus}`) as an ext notification; it sends again only when the status changes. The client learns sign-in without asking. Shapes are in `dist/auth-status.js`; seen: `{'authStatus': {'kind': 'account', 'label': 'Claude Max', 'account': {'plan': 'max', ...}}}`.
- The Python SDK strips the leading underscore before calling `Client.ext_notification` / `ext_method` (`acp/router.py`: `method[1:]`), so match `auth/status_update`, not `_auth/status_update` (checked in `agent-client-protocol` 0.12.1, 2026-11-04).
