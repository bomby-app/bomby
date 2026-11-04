# ACP and claude-agent-acp notes

Checked 2026-11-03/04 against `claude-agent-acp` 0.100.0 and `codex-acp` 2.2.2 (`dist/` in `agent/adapters/node_modules/@agentclientprotocol/<adapter>/`) and Python SDK `agent-client-protocol` 0.12.1 (`agent/.venv/lib/python3.13/site-packages/acp/`). Read source for behavior, not memory.

## Adapters

- `agent/adapters/package.json` pins them. The app installs them on Set up into its own folder ([decision](decisions/install-adapters-on-setup.md)); `just agent install` builds the repo's copy for console runs. Both install with bun (`--omit optional`) and compile each into one program (`bun build --compile`, 90 MB each, mostly the bun runtime). Harnesses start them by path, `BOMBY_ADAPTERS` or `agent/adapters/bin`, so neither PATH nor Node matters, and the agents' own bundled binaries (optional packages) are never installed.
- ACP Registry v1 (`cdn.agentclientprotocol.com/registry/v1/latest/registry.json`, 2026-11-04): 44 agents; `distribution` is `binary` (per-platform archive, `cmd`, `sha256`), `npx` or `uvx`. Claude's adapter (`claude-acp`, license `proprietary`) and Codex's (`codex-acp`, Apache-2.0) are `npx` only.
- Not through mise: its npm backend puts the package's `node_modules/.bin` on PATH, and `codex-acp` ships a `codex` (0.160.1 with 2.2.2) that then shadowed the user's own in the repo; it clashed with their Codex background server's feature settings (2026-11-04).

## Protocol

- The SDK speaks ACP v1 (`PROTOCOL_VERSION = 1`); adapter v2 is a draft.
- Methods used: `initialize`, `new_session`, `set_session_mode`, `prompt`, `cancel`, `close_session`, `ext_method`, and `session/delete` through the connection's raw `send_request` (the probe; no SDK method). `resume_session` and `load_session` are available for roadmap step 4.
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
| OpenCode 2.1.4 | Session opens on its free models (`model` = `opencode/big-pickle`): ready | `opencode-login`: "Run `opencode auth login` in the terminal" |
| omp 18.16.0 | Session opens without a `model` config option | `agent`: "Use existing local credentials" |
| Codex (adapter 2.2.2) | `session/new` fails with `auth_required` (`-32000`, "Authentication required") | `api-key` and `chat-gpt`, no command |
| goose 1.57.0 | `session/new` fails: `-32603` "Internal error", `data`: "Failed to resolve provider and model: Configuration value not found: GOOSE_PROVIDER" | `goose-provider`: "Run `goose configure` to set up your AI provider and API key" |

- Only Codex returns `auth_required` (`-32000`, `acp/exceptions.py`). Elsewhere the useful text is in `RequestError.data`, while `str(error)` is the generic JSON-RPC message.
- `authMethods` are the same configured or not, so they say how to fix a problem, not whether there is one.
- A configured session has a config option with `category: "model"`; its `currentValue` is the model in use.
- `_auth/status_update` is the adapter's interim `authStatus` extension (`dist/auth-status.d.ts`): advertised by an empty `agentCapabilities._meta.authStatus`, pushed after `initialize` (never before its response) and on each `session/new`. `kind` is `account`, `api_key`, `gateway`, `external` or `none`; `label` is a display string such as "Claude Max". Silence means unknown.
- `session/new` saves a session in the agent's history even without a prompt (Codex, OpenCode, omp, goose; Claude saves only once prompted). Claude, Codex, OpenCode and goose advertise `sessionCapabilities.delete`; omp only `close`. Codex's delete archives the thread (`threadArchive`: it moves to `~/.codex/archived_sessions`, out of the resume list, still on disk). `omp acp --no-session` still saves the session (omp 18.16.0). SDK 0.12.1 has `DeleteSessionRequest` in `acp/schema.py` and `session/delete` in `acp/meta.py`, but no `delete_session` method on `ClientSideConnection`.
