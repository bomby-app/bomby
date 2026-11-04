# Check each agent's setup with an ACP probe

Status: accepted, 2026-11-04. Extends [detect-acp-native-agents.md](detect-acp-native-agents.md).

## Context

An installed agent can still be unusable: goose with no provider, omp with no model, Claude signed out. Before this, Settings only knew that the program existed (and Claude's sign-in, from `claude auth status`), and a call found out mid-task, from an error the voice model read out raw. Probing each agent unconfigured ([acp-notes.md](../acp-notes.md#setup-signals)) showed none of them uses ACP's `auth_required`, but every signal is still ACP data: a refused `session/new`, a session without a `model` option, or the `authStatus` extension.

## Decision

- **One generic probe** (`agent/acp_client/probe.py`), the same for every harness: `initialize`, `session/new` in an empty folder, no prompt. An agent needs setup when the session is refused, when it reports `authStatus` kind `none`, or when it offers config options but none in the `model` category. The agent's own words say what's wrong; its `authMethods`, or the harness's `setup_command`, say how to fix it. The probe deletes its session where the agent supports `session/delete`, and closes it otherwise.
- **The harness is defined once, in Python.** The core runs the probe as the agent's subcommand (`probe.py`; in the packaged app, the frozen agent with a `probe` argument) with the programs it found, and reads JSON back. Rust keeps only how to find a program; Claude's `claude auth status` check is gone, since the probe reads the same account from the adapter.
- **When it runs.** In the background, after a look, for agents with no stored result, a changed path or version, or a last result that wasn't ready; and for every installed agent on Check again. Results are kept in the app's database, so a launch doesn't probe agents that were fine. A call never waits for it.
- **Errors during a call are sentences.** The runner turns spawn failures, refused sessions, sign-in errors and crashed agents into what happened and what the user can do, from the same ACP data (`agent/acp_client/problems.py`).

## Consequences

- A new ACP agent gets setup checks and readable errors with no code of its own; a harness adds `setup_command` only when its `authMethods` don't name one.
- omp can't delete sessions, so each omp probe leaves an empty session in its history. Probing only when something changed keeps that rare.
- A setup that breaks after a probe still shows as ready until Check again; the call's spoken error points there.
- Release builds can't probe until the agent ships as a sidecar ([roadmap step 7](../roadmap.md)); Settings then shows agents as installed, as before.
