# Pick an agent's settings like Buzz and Zed

Status: accepted, 2026-11-05. Builds on [check-agent-setup-with-an-acp-probe.md](check-agent-setup-with-an-acp-probe.md).

## Context

An agent runs on whatever model it opens sessions on, and that isn't always the user's: `opencode acp` ignores the model its window last used and picks the newest it can, which once was a preview model that answered every turn with nothing ([acp-notes.md](../acp-notes.md#session-settings)). A first attempt made picking a model a required setup step, in a dialog that started the agent again on every change and re-checked every agent on Save; it was slow and in the way. Clients that solve this already, Block's Buzz (a Tauri desktop app over ACP, `block/buzz`) and Zed, keep it optional (owner, 2026-11-05).

## Decision

- **Optional, as in Buzz and Zed, unless the agent's default isn't the user's.** An agent is ready once it's signed in; its own defaults apply until the user picks something. Buzz keeps `model` and `effort_level` as optional fields applied after every `session/new` (`crates/buzz-acp/src/config.rs`, `pool.rs`); Zed keeps a per-agent `default_config_options` map, by option id.
- **Required where the default can't be trusted, by a switch on the harness** (owner, 2026-11-05). `model_selection_required` on a harness means a call uses that agent only once the user has picked its model: until then, and when the picked model is gone, the probe finds it not ready (`needs_pick`) and its row asks to pick. OpenCode sets it: `opencode acp` ignores the user's model for the newest it can reach (`packages/core/src/model.ts`, 2.2.5). Claude, Codex, goose and omp start on the user's own default (omp: `settings.getModelRole("default")`, `packages/coding-agent/src/sdk.ts`, 18.16.0), so they don't. A new agent with the same problem sets the switch; nothing else changes.
- **A model picker on the agent's row** (`ModelPicker` in `app/src/features/agents/`), on Settings, Agents and the first-run splash, like Buzz's on its agent card (`desktop/src/features/agents/ui/ModelPicker.tsx`): the button names the model; opening it asks the agent what it offers (one short-lived probe, as Buzz's `buzz-acp models` is), and each pick is saved at once. It offers the `model` and `thought_level` settings plus any a harness names in `setup_settings` (goose's `provider`), in the agent's order. A pick asks the agent again with the picks so far, since one can change what the next offers, and is saved once the agent has answered. The settings before the one picked are saved with it, at their current values: a later setting can depend on them (goose's models on its provider), so its value only means something with theirs. The picker opens on the agent's last answer while it asks again.
- **Bomby keeps the picks, not the agent.** The core stores them by agent, in order (`agent_choices`, `app/src-tauri/src/agent_choices.rs`); a pick updates only that agent's row, with no re-check of the others, and a background look that started before the pick keeps it. A look that opens no session in an agent (omp) keeps the model its last listing found. Calls carry them in the job metadata, and the runner applies them to every session with `session/set_config_option`, which every agent keeps to the session.
- **A pick that doesn't apply isn't fatal,** as in Buzz: one the agent no longer offers, or refuses (a goose provider with no key), is skipped, the session keeps the agent's default, and the row and the picker say which setting; for an agent whose harness requires a pick, it needs one again. Nothing it picked can lock the user out of picking again.

## Consequences

- Opening the picker takes as long as starting the agent, a few seconds; picking is the same again.
- Every opening and every pick on omp leaves a session in omp's history, which can't delete sessions; the background check never opens one there.
- The agent run by hand keeps its own model.
