# Detect the agents on the user's computer, ACP-native first

Status: accepted, 2026-11-04. Extends [users-bring-their-own-keys-and-claude.md](users-bring-their-own-keys-and-claude.md): the user brings an agent, Claude Code or another.

## Context

People use more than Claude Code, and many agents speak ACP. Bomby should work with whichever the user has, without a setting for each, and without us shipping their software.

## Decision

- The core finds known agents on the computer (`app/src-tauri/src/agents.rs`): Claude Code, OpenCode, omp and goose today. It looks each program up through the user's login shell, then in its usual install places, and reads its version (and Claude's sign-in).
- Only agents that speak ACP themselves are added (`opencode acp`, `omp acp`, `goose acp`). Claude Code is the exception, through the `claude-agent-acp` adapter we already ship. Agents that need a third-party adapter (pi through `pi-acp`) wait: we'd have to bundle it.
- The core looks once at launch, in the background, and keeps the result; Settings shows it without waiting and asks for a fresh look on its own. Each call looks again for where the programs are (not their versions or sign-in), so an agent installed since launch is picked up, and the found agents go to the voice agent in the job metadata (`"agents": {"claude": "/path/claude", ...}`). The voice model can only use those; the default is Claude when it's installed.
- A call keeps the agents it opened with: every token for that call, reconnects included, carries the same list, so a look during a call never changes what its voice agent can use. A look whose login shell fails keeps the programs found before that are still on disk, instead of reporting them gone.
- Settings has an Agents section listing what the core reports. Setup shows the keys and whether any agent is ready, each with a button to the section that fixes it.

## Adding an agent

1. A row in `KNOWN` in `agents.rs`: id, name, program, usual install places, optional sign-in check.
2. A `Harness` in `agent/harnesses/` with the same id: `program` and `args` for a native agent, or `adapter` and `program_env` for one behind an adapter, and `setup_command` if its ACP `authMethods` name no command to set it up. List it in `HARNESSES` and add its id to `AgentName`. Its setup check and error messages need nothing more ([probe](check-agent-setup-with-an-acp-probe.md)).
3. Optionally a logo in `app/src/features/agents/agent-logos.tsx`.

## Consequences

- Every agent uses the user's own setup. Claude and omp support steering; OpenCode and goose queue mid-task requests behind the running turn. OpenCode permissions are approved once, omp does not prompt, and goose uses `auto`.
- A call needs at least one agent; with none, starting one says so and points at Settings, Agents.
