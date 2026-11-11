# ACP and claude-agent-acp notes

Checked 2026-11-03/04 against `claude-agent-acp` 0.100.0 and `codex-acp` 2.2.2 (`dist/` in `agent/adapters/node_modules/@agentclientprotocol/<adapter>/`) and Python SDK `agent-client-protocol` 0.12.1 (`agent/.venv/lib/python3.13/site-packages/acp/`). Read source for behavior, not memory.

## Adapters

- `agent/adapters/package.json` pins them. The app installs them on Set up into its own folder ([decision](decisions/install-adapters-on-setup.md)); `just agent install` builds the repo's copy for console runs. Both install with bun (`--omit optional`) and compile each into one program (`bun build --compile`, 90 MB each, mostly the bun runtime). Harnesses start them by path, `BOMBY_ADAPTERS` or `agent/adapters/bin`, so neither PATH nor Node matters, and the agents' own bundled binaries (optional packages) are never installed.
- ACP Registry v1 (`cdn.agentclientprotocol.com/registry/v1/latest/registry.json`, 2026-11-04): 44 agents; `distribution` is `binary` (per-platform archive, `cmd`, `sha256`), `npx` or `uvx`. Claude's adapter (`claude-acp`, license `proprietary`) and Codex's (`codex-acp`, Apache-2.0) are `npx` only.
- Not through mise: its npm backend puts the package's `node_modules/.bin` on PATH, and `codex-acp` ships a `codex` (0.160.1 with 2.2.2) that then shadowed the user's own in the repo; it clashed with their Codex background server's feature settings (2026-11-04).

## Protocol

- The SDK speaks ACP v1 (`PROTOCOL_VERSION = 1`); adapter v2 is a draft.
- Methods used: `initialize`, `new_session`, `set_session_mode`, `prompt`, `cancel`, `close_session`, `ext_method`, and `session/delete` through the connection's raw `send_request` (no SDK method; `acp_client/sessions.py`, for the probe's sessions and one a call drops because its model pick is missing). `resume_session` and `load_session` are available for roadmap step 4.
- `spawn_agent_process(client, cmd, *args, env=, cwd=, transport_kwargs=)` merges `env` with a minimal default environment, so the runner passes the full filtered environment. `transport_kwargs={"limit": ...}` tunes line-buffer round trips; longer lines still reassemble.
- No request has a timeout of its own: `Connection.send_request` awaits the answer until the connection closes (agent-client-protocol 0.12.1, `acp/connection.py`). The runner gives starting an adapter and opening a session 30 s each (`START_TIMEOUT_S` in `acp_client/runner.py`), the probe 30 s for its whole check (`TIMEOUT_S` in `acp_client/probe.py`). Leaving `spawn_agent_process` closes stdin, waits 2 s for the process to exit, then terminates and kills it (`spawn_stdio_transport`, `shutdown_timeout=2.0`, `acp/transports.py`).
- Drain adapter stderr or it blocks. Unimplemented client methods (fs, terminal, elicitation) return method-not-found; Claude Code does its own file and shell work.
- **A cancelled turn is over when its prompt is answered, not when `session/cancel` is sent.** `cancel` is a notification: awaiting it waits for the send. The agent then stops its tools, sends its last updates and answers the original `session/prompt` with `cancelled` ([prompt turn, cancellation](https://agentclientprotocol.com/protocol/v1/prompt-turn#cancellation)). The SDK drops a request's pending future when the task awaiting it is cancelled (`acp/connection.py`, `send_request`, agent-client-protocol 0.12.1), so the runner keeps the prompt in a task of its own and waits for it after cancelling, up to `STOP_TIMEOUT_S` (10 s), with the turn's lock, reply and stream still held (`AcpRunner._stop_turn`). Past that it stops the adapter.

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

## Streams

What the Agents panel reads of `session/update` (agent-client-protocol 0.12.1, `acp/schema.py`; [decision](decisions/agent-streams-through-the-core.md)):

- `AgentMessageChunk` with a `TextContentBlock` (`content.text`, optional `message_id`), `ToolCallStart` (`tool_call_id`, `title`, optional `kind` and `status`) and `ToolCallProgress` (the same id, every other field optional: a patch). A `ToolCallStart` without `status` is `pending`. `ToolKind`: read, edit, delete, move, search, execute, think, fetch, switch_mode, other. `ToolCallStatus`: pending, in_progress, completed, failed.
- Never read: `AgentThoughtChunk`, plans, `content`, `locations`, `raw_input`, `raw_output` and `_meta`, which carry whole files and command output on some agents. A `ToolCallProgress` with none of title, kind and status (only output) isn't sent.
- What each agent sends (from their sources, not run): message deltas and tool calls with updates on all five; `kind` on all but goose 1.57.0 (always `other`); Claude's and Codex's title for a shell call is the command line itself.

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
| Codex (`codex-acp` 2.2.2, codex-cli 0.164.0) | Codex has no ACP mode; the adapter runs `CODEX_PATH` (`dist/index.js`), falling back to the Codex it bundles (335 MB installed). Modes `read-only`, `workspace-write`, `agent` (default), `agent-full-access` ("never" approvals, `danger-full-access`); config `mode`, `collaboration_mode`, `model`, `reasoning_effort`, `fast-mode`. Capabilities: list, delete, additional directories, fork, resume, close. Steering through `_session/steering`, advertised in top-level `_meta.steering.supported`. Pushes `_auth/status_update` like Claude's adapter. Reads `CODEX_API_KEY`/`OPENAI_API_KEY` only for the client's `api-key` `authenticate`. |
| goose 1.57.0 (`goose acp`) | Modes `auto` (default), `approve`, `smart_approve`, `chat`; config `provider`, `mode`, `model`, `thinking_effort`. Capabilities: list, delete, close. No steering. Bomby sets `auto`. |
| pi 1.5.0 | No native ACP, only `--mode rpc`; unsupported because `pi-acp` would be another adapter to ship. |

**Instructions.** ACP `session/new` has no instructions field, only `cwd`, `additionalDirectories`, `mcpServers` and `_meta`. Claude's `systemPrompt.append` is adapter-specific. OpenCode reads no `_meta` options, omp reads steering, and goose exposes no ACP route to its internal `system_prompt_extras`. The runner therefore briefs each session once (`briefing()` in `acp_client/runner.py`): system prompt where supported, otherwise a text block before the first task. This also tells omp and goose about extra folders, which they do not expose as `additionalDirectories`.

**Permissions.** Claude uses `bypassPermissions`, goose `auto`, and omp does not ask. OpenCode has no bypass mode, so the client uses `allow_once`, never `allow_always`, which would persist rules. Per-agent settings and voice prompts come later ([decision](decisions/bypass-permissions-for-now.md)).

## Setup signals

Probed 2026-11-04: `initialize` then `session/new` in an empty folder, no prompt, once with the user's setup and once with an empty `HOME` and `XDG_*` folders (an unconfigured install).

| Agent | Unconfigured | `authMethods` |
| --- | --- | --- |
| Claude (adapter 0.100.0) | Session opens; `_auth/status_update` pushes `{"kind": "none", "label": "Not logged in"}` | None unless the client offers terminal auth, and those run the adapter itself (`--cli auth login`) |
| OpenCode 2.1.4 | Session opens on its free models (`model` = `opencode/big-pickle`): signed in, but Bomby asks to pick its model first (`model_selection_required`) | `opencode-login`: "Run `opencode auth login` in the terminal" |
| omp 18.16.0 | Session opens without a `model` config option | `agent`: "Use existing local credentials" |
| Codex (adapter 2.2.2) | `session/new` fails with `auth_required` (`-32000`, "Authentication required") | `api-key` and `chat-gpt`, no command |
| goose 1.57.0 | `session/new` fails: `-32603` "Internal error", `data`: "Failed to resolve provider and model: Configuration value not found: GOOSE_PROVIDER" | `goose-provider`: "Run `goose configure` to set up your AI provider and API key" |

**OpenCode's model over ACP.** `opencode acp` doesn't use the model the TUI last picked (kept in its own state, `~/.local/state/opencode/model.json`). Without `model` in `opencode.json` it picks a default of its own, which can be a model the user never chose: on 2.2.5 it opened sessions on an OpenRouter preview model that ended every turn with an empty message (its session record in `~/.local/share/opencode/opencode.db`, 2026-11-05). So OpenCode's harness sets `model_selection_required`: Bomby uses it only once the user has picked its model, which the runner sets per session ([Session settings](#session-settings)); `model` in `opencode.json` sets it for every client.

- Only Codex returns `auth_required` (`-32000`, `acp/exceptions.py`). Elsewhere the useful text is in `RequestError.data`, while `str(error)` is the generic JSON-RPC message.
- `authMethods` are the same configured or not, so they say how to fix a problem, not whether there is one.
- A configured session has a config option with `category: "model"`; its `currentValue` is the model in use.
- `_auth/status_update` is the adapter's interim `authStatus` extension (`dist/auth-status.d.ts`): advertised by an empty `agentCapabilities._meta.authStatus`, pushed after `initialize` (never before its response) and on each `session/new`. `kind` is `account`, `api_key`, `gateway`, `external` or `none`; `label` is a display string such as "Claude Max". Silence means unknown.
- `session/new` saves a session in the agent's history even without a prompt (Codex, OpenCode, omp, goose; Claude saves only once prompted). Claude, Codex, OpenCode and goose advertise `sessionCapabilities.delete`; omp only `close`. Codex's delete archives the thread (`threadArchive`: it moves to `~/.codex/archived_sessions`, out of the resume list, still on disk). `omp acp --no-session` still saves the session (omp 18.16.0). SDK 0.12.1 has `DeleteSessionRequest` in `acp/schema.py` and `session/delete` in `acp/meta.py`, but no `delete_session` method on `ClientSideConnection`.

## Session settings

ACP's way to pick a model, effort or mode (SDK 0.12.1, `acp/schema.py`): `session/new` answers with `configOptions`, each with an `id`, a `name`, a `category` (`mode`, `model`, `model_config`, `thought_level`, or a custom object), a `currentValue` and its options, flat or in named groups. `session/set_config_option` (`ClientSideConnection.set_config_option`) changes one and answers with the whole list again, so a setting that depends on another comes back up to date: OpenCode lists an effort only once a model with variants is picked, and goose's models follow its provider.

Checked on 2026-11-05 against each agent's source at the installed version, and live through the probe:

| Agent | Model | Effort | Other | A change lasts |
| --- | --- | --- | --- | --- |
| Claude (adapter 0.100.0, `dist/acp-agent.js` `selectSessionConfigOption`) | `model` | `effort` | `mode`, `fast`, `ultracode` (`model_config`), `agent` (no category) | the session (`query.setModel`); no settings written |
| Codex (adapter 2.2.2, `dist/index.js` `applySessionConfigOption`) | `model` | `reasoning_effort` | `mode`, `collaboration_mode` (no category), `fast-mode` | the session's state |
| OpenCode 2.2.5 (`packages/cli/src/acp/config-option.ts`, `service.ts`) | `model` | `effort`, for models with variants | `mode` | the session's selection |
| goose 1.57.0 (`crates/goose/src/acp/server/dispatch.rs`, `server.rs` `on_set_model`) | `model` | `thinking_effort` | `provider` (no category), `mode` | the session (`switch_provider`) |
| omp 18.16.0 (`packages/coding-agent/src/modes/acp/acp-agent.ts`) | `model`, once a provider is signed in | `thinking` | `mode` | the session: `setModel` saves a default only with `persist`, which ACP doesn't pass |

Bomby's model picker offers the `model` and `thought_level` settings and any a harness names in `pickable_settings` (goose's `provider`), in the agent's order, and leaves `mode` to the runner (`agent/acp_client/settings.py`). An unknown value fails with `invalidParams` everywhere.
