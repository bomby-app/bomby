# Remember the launch check

Status: accepted, 2026-11-11 (owner). Changes when [check-agent-setup-with-an-acp-probe.md](check-agent-setup-with-an-acp-probe.md) runs the probe.

## Context

Every look started every installed agent: at launch, on Check again, and after a call found new programs. Starting one costs seconds and, for an agent that reads an untrusted keychain item (goose, [agent-keys-through-the-environment.md](agent-keys-through-the-environment.md)), a password dialog. Most launches find nothing changed since the last.

## Decision

- **A harness may name the files that hold its setup** (`setup_files`; goose: `~/.config/goose/config.yaml`). The probe reports them, home folder expanded. Only an agent that names some is remembered; Claude, Codex, OpenCode and omp name none and are checked at every launch, as before.
- **Only a `ready` answer from a session is remembered** (`agent_checks` in `bomby.db`, `src-tauri/src/agent_checks.rs`), with its fingerprint: the program (symlinks resolved, its size and modification time, read from the file so fingerprinting starts nothing), each setup file's modification time, the user's picks, the names of the keys saved for it (never a key) and Bomby's version. Anything else is checked fresh.
- **A look reuses it** instead of starting the agent while the fingerprint is the same and it's less than a day old.
- **An answer is recorded only against what it saw.** A check notes when it started; if the program or a setup file was modified at or after that (the probe answers for all agents at once, so one agent's answer can wait on another's), its answer isn't recorded. And a check that started before the agent's keys changed or a call found it not ready isn't recorded at all: those bump the agent's revision (`Agents::invalidate`), which recording checks, both under the database's lock. Nor does such a check change the agent's row, so a look still running on an old key can't put its failure back over the recheck that found the new key working.
- **It's checked again**: when the fingerprint differs or a day has passed; always on Check again, which forgets every remembered check; whenever the model picker or a pick asks the agent live, whose answer replaces it, a failed one (no session, or no answer) forgetting it and showing on the row so calls leave the agent out; when its keys change; and after a call in which the agent wasn't ready. The worker logs that as `coding agent not ready` with the agent's id in `not_ready` (`report_not_ready` in `agent/acp_client/runner.py`); the core reads it from the worker's output, as it reads crashed jobs, forgets the check at once and looks again when the call ends, never during it.
- The merge rules of a look (`keep_what_the_look_missed`, `checked`, `picked_since` in `agents.rs`) are unchanged; a reused setup enters them like a fresh one with a session.

## Consequences

- With goose set up and unchanged, launch and Settings start no goose; Check again still does.
- A change outside the fingerprint (a key goose keeps in its own keychain, a provider's outage) shows only after a day, Check again, or a call that finds goose not ready.
- Program updates are caught by the binary's size and modification time rather than `--version`, so deciding needs no process.
