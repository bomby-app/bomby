# Set up every agent the same way

Status: accepted, 2026-11-05. Builds on [check-agent-setup-with-an-acp-probe.md](check-agent-setup-with-an-acp-probe.md).

## Context

An agent counted as ready as soon as the probe found it signed in, and ran on whatever model it opened sessions on. That isn't always the user's: `opencode acp` ignores the model its window last used and picks the newest it can, which once was a preview model that answered every turn with nothing ([acp-notes.md](../acp-notes.md#session-settings)). omp listed no model at all until it had a provider. The owner wanted one setup flow for every agent, as apps like this have, with the choice kept by Bomby (owner, 2026-11-05).

## Decision

- **One flow, the same for every agent** (`setupStep` in `app/src/features/agents/use-agents.ts`), on each row in Settings, Agents and on the first-run splash's card: Set up (installs its ACP adapter, if it needs one), sign in (the agent's own command and Check again), then Pick model, the one step with a dialog (`AgentSetupDialog`), and save. Connecting and signing in happen in place; the dialog shows them only for an agent whose needs show once a session opens (omp without a provider). The user never reads about adapters (owner, 2026-11-05).
- **The settings are ACP's.** The flow offers what the agent lists in `configOptions` under the `model` and `thought_level` categories, plus any its harness names in `setup_settings` (goose's uncategorized `provider`), in the agent's order (`agent/acp_client/settings.py`). Each change asks the agent again with the choices so far, because one can change what the next offers. `mode` stays out: Bomby sets it for permissions.
- **Bomby keeps the choice, not the agent.** The core stores each agent's choices in order (`agent_setups`, `agent_choices`; `app/src-tauri/src/agent_setups.rs`). Calls carry them in the job metadata, and the runner applies them to every session with `session/set_config_option`. Every agent keeps such a change to the session, so nothing in the agent's own config changes.
- **Only a set-up agent is ready.** Calls get an agent only once it's set up and the probe finds it signed in with its choices still offered. A choice that's gone (a model removed or renamed) makes it need setup again, and the flow opens on picking.
- **The flow may leave one session.** The background probe opens a session only in an agent that can delete it; the flow, which the user starts, needs one to list the settings, so it opens one in omp too and closes it, leaving it in omp's history.

## Consequences

- Agents that were ready before this need one pass through the flow.
- A new agent gets the flow with no code of its own, unless it lists a setting without a category, which its harness then names.
- Each change in the flow starts the agent once, a few seconds, so the dialog shows it checking.
- The setup lives in Bomby: the agent run by hand keeps its own model.
