# Check each agent's setup with an ACP probe

Status: accepted, 2026-11-04. Extends [detect-acp-native-agents.md](detect-acp-native-agents.md). The model picker builds on it: [pick-agent-settings-like-buzz-and-zed.md](pick-agent-settings-like-buzz-and-zed.md).

## Context

An installed agent can still be unusable: goose with no provider, omp with no model, Claude signed out. Before this, Settings only knew that the program existed (and Claude's sign-in, from `claude auth status`), and a call found out mid-task, from an error the voice model read out raw. Probing each agent unconfigured ([acp-notes.md](../acp-notes.md#setup-signals)) showed none of them uses ACP's `auth_required`, but every signal is still ACP data: a refused `session/new`, a session without a `model` option, or the `authStatus` extension.

## Decision

- **One generic probe** (`agent/acp_client/probe.py`), the same for every harness: `initialize`, then `session/new` in an empty folder, no prompt. An agent needs setup when the session is refused, when it reports `authStatus` kind `none`, or when it offers config options but none in the `model` category. The agent's own words say what's wrong; its `authMethods`, or the harness's `setup_command`, say how to fix it.
- **The probe decides the step, once.** Its answer carries one `step` (`connect`, `sign_in`, `pick`, `unreachable` or `ready`), which the core (`Step` in `setup.rs`) and the page (generated from it) read as is, rather than each guessing it again from the other fields.
- **No leftovers.** A session lands in the agent's history, so the probe opens one only when the agent advertises `session/delete`, and deletes it. An agent without it gets `initialize` only: a rule on the capability, not a list of agents. Today that is omp, which also ignores `--no-session` in ACP mode. Two exceptions open one there and close it: the first look of each launch, and Check again (Refresh models), so its setup and model are checked rather than assumed (`checked` in `agents.rs`, owner, 2026-11-05); and the model picker, when it first asks in a launch.
- **The harness is defined once, in Python.** The core runs the probe as the agent's subcommand (`probe.py`; in the packaged app, the frozen agent with a `probe` argument) with the programs it found, and reads JSON back. Rust keeps only how to find a program.
- **Part of every look.** The probe runs beside the version checks in each look: at launch, in the background, and on Check again (owner, 2026-11-04). It applies the settings picked for each agent and notes any it no longer offers, and starts each agent with the keys the user saved for it ([agent-keys-through-the-environment.md](agent-keys-through-the-environment.md)). A ready answer for an agent whose harness names its setup files is remembered across launches, and later looks reuse it instead of starting that agent while nothing it depends on changed; every other agent is probed at every look ([remember-the-launch-check.md](remember-the-launch-check.md)).
- **Calls only get agents that are set up.** `open_call` leaves out an agent the last look found not set up; one the probe couldn't check stays in.
- **Errors during a call stay short.** The voice model gets one friendly line, that the agent isn't ready or stopped before finishing, and is told to say sorry and offer another agent. What to fix lives in Settings, not in the call (owner, 2026-11-04).

## Consequences

- A new ACP agent gets setup checks and friendly errors with no code of its own; a harness adds `setup_command` only when its `authMethods` don't name one.
- A look takes about as long as the slowest agent's start, 2 to 3 s, in the background; an agent whose check is remembered adds nothing.
- omp gets one session in its history per launch, and one per Check again (Refresh models in Settings, Agents); later looks keep what that one found.
- A setup that changes while the app runs shows after Check again, or after a call that found the agent not ready; until then a call says sorry and offers another agent.
