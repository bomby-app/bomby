# ACP and claude-agent-acp notes

Checked 2026-11-03/04 against `claude-agent-acp` 0.100.0 (`dist/acp-agent.js` in `~/.local/share/mise/installs/npm-agentclientprotocol-claude-agent-acp/0.100.0/`) and Python SDK `agent-client-protocol` 0.12.1 (`agent/.venv/lib/python3.13/site-packages/acp/`). Read source for behavior, not memory.

## Protocol

- The SDK speaks ACP v1 (`PROTOCOL_VERSION = 1`); adapter v2 is a draft.
- Methods used: `initialize`, `new_session`, `set_session_mode`, `prompt`, `cancel`, `close_session`, `ext_method`. `resume_session` and `load_session` are available for roadmap step 4.
- `spawn_agent_process(client, cmd, *args, env=, cwd=, transport_kwargs=)` merges `env` with a minimal default environment, so the runner passes the full filtered environment. `transport_kwargs={"limit": ...}` tunes line-buffer round trips; longer lines still reassemble.
- Drain adapter stderr or it blocks. Unimplemented client methods (fs, terminal, elicitation) return method-not-found; Claude Code does its own file and shell work.

## Sessions

- `new_session(cwd, additional_directories=[...], mcp_servers=[], **meta)` puts extra kwargs in `_meta`. Directories must be absolute.
- Claude accepts `systemPrompt={"append": "..."}` in `_meta`; a string would replace the prompt instead.
- New Claude sessions use the settings' `defaultMode`; call `set_session_mode(session_id, "bypassPermissions")` after creation. Root without a sandbox, `permissions.disableBypassPermissionsMode: "disable"` or `_meta.claudeCode.options.allowDangerouslySkipPermissions: false` can block bypass. The runner then warns and auto-approves requests.
- `sessionCapabilities.close` is advertised on v1; closing cancels a running turn. The SDK agent router exposes it only with `use_unstable_protocol`.
- Prompts to one session queue and answer in order.

## Steering

- `_session/steering` is an extension request; SDK `ext_method("session/steering", params)` adds the underscore. Support is advertised at initialize in top-level `_meta.steering.supported`.
- Params: `{"sessionId", "prompt": [content blocks], "_meta": {"steering": {"idleBehavior": "promptRequired"}}}`.
- During a turn, steering injects the message and the original `prompt` response covers both. With no running turn, `promptRequired` returns `{"outcome": "promptRequired"}` so the client sends a normal prompt; without it, the adapter starts a detached turn.

## Replies

- The SDK runs each `session/update` notification as its own task but resolves responses inline. `session_update` must not await slow work; queue it instead.
- `AgentMessageChunk.messageId` identifies one message. A new id or `ToolCallStart` marks earlier text as narration; the runner keeps only the last message. After steering, the briefing asks Claude's final message to cover the whole task.
- The adapter pushes `_auth/status_update`; the SDK strips the leading underscore before `Client.ext_notification`, so match `auth/status_update` (`acp/router.py`).

## Billing and Claude discovery

- Strip `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` so Claude uses the user's plan login. Strip `CLAUDECODE`, which prevents nested launches.
- `claudeCliPath()` prefers `CLAUDE_CODE_EXECUTABLE` over the Agent SDK's bundled CLI; session start passes it as `pathToClaudeCodeExecutable`.
- After initialize, the adapter probes login in the background and pushes `_auth/status_update` (`{authStatus}`) when it changes. Shapes are in `dist/auth-status.js`.

## Other agents

Probed 2026-11-04 with `initialize` and `session/new`, no prompt. See [detection decision](decisions/detect-acp-native-agents.md).

| Agent | ACP behavior |
| --- | --- |
| OpenCode 2.1.4 (`opencode acp`) | Config: `model`, `effort`, `mode` (`build`, `plan`). Capabilities: list, delete, additional directories, fork, resume, close. No steering; permission requests follow its config and arrive as `session/request_permission`. |
| omp 18.16.0 (`omp acp`) | Modes `default`, `plan`; config `mode`, `model`, `thinking`. Supports `_session/steering` with `promptRequired`; no permission prompts by design. |
| goose 1.57.0 (`goose acp`) | Modes `auto` (default), `approve`, `smart_approve`, `chat`; config `provider`, `mode`, `model`, `thinking_effort`. Capabilities: list, delete, close. No steering. Bomby sets `auto`. |
| pi 1.5.0 | No native ACP, only `--mode rpc`; unsupported because `pi-acp` would be another adapter to ship. |

**Instructions.** ACP `session/new` has no instructions field, only `cwd`, `additionalDirectories`, `mcpServers` and `_meta`. Claude's `systemPrompt.append` is adapter-specific. OpenCode reads no `_meta` options, omp reads steering, and goose exposes no ACP route to its internal `system_prompt_extras`. The runner therefore briefs each session once (`briefing()` in `acp_client/runner.py`): system prompt where supported, otherwise a text block before the first task. This also tells omp and goose about extra folders, which they do not expose as `additionalDirectories`.

**Permissions.** Claude uses `bypassPermissions`, goose `auto`, and omp does not ask. OpenCode has no bypass mode, so the client uses `allow_once`, never `allow_always`, which would persist rules. Per-agent settings and voice prompts come later ([decision](decisions/bypass-permissions-for-now.md)).
