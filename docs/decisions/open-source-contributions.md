# Contributions: issue first, MIT in and out, CI runs `just check`

Status: accepted, 2026-11-08

## Context

The repository goes public with a beta. Bomby is designed and tested by the owner and written mostly by coding agents, so outside pull requests have to fit a product with firm opinions on how it looks, sounds and behaves. CI didn't exist: only the Release workflow ran on GitHub, and `just check` failed on a fresh clone (basedpyright ran through `uvx` before `agent/.venv` existed, so it saw no dependencies).

## Decision

- **Issue first.** Anything beyond a small fix starts as an issue the owner marks `accepted`; design changes are designed first, and the spoken prompts stay the owner's ([CONTRIBUTING.md](../../CONTRIBUTING.md)). Pull requests written with agents are welcome; their author answers for every line.
- **MIT in, MIT out** (owner, 2026-11-08). No CLA and no sign-off: a contribution is licensed under the repository's MIT License. The brand stays out of it ([TRADEMARKS.md](../../TRADEMARKS.md)).
- **CI runs the recipes developers run** (`.github/workflows/ci.yml`): `agent` (`just agent check`, on Linux, since the agent is plain Python), `app` (`just app check`, on the `xcode-27` macOS runner the Release workflow uses) and `repo` (`just lint-workflows`, `just lint-docs`) are required; `advisories` (RustSec, also weekly) isn't, since a new advisory can land on any day; `dependency-review` runs on public pull requests. Pull requests get a read-only token and no secrets. `.github/workflows/package.yml` builds the app unsigned and runs the frozen agent on a pull request that could break packaging; never on a push to main, which its pull request already checked.
- **Every tool a check runs is pinned**: ruff and basedpyright in the agent's `dev` group (run with `uv run`, which also syncs the venv first), cargo-deny and lychee in `mise.toml`, the actions by commit SHA.
- **No bots open pull requests** (owner, 2026-11-08): no Renovate, no Dependabot version or security updates, no automatic Copilot review. Dependencies are updated by hand. GitHub's Dependabot alerts (alerts only) and the `advisories` job say when one has a known vulnerability.
- **cargo-deny** (`app/src-tauri/deny.toml`) allows permissive licenses and MPL-2.0 (cssparser and selectors, through Tauri), for the Apple Silicon target only, crates from crates.io only.

## Consequences

- Required checks are named `agent`, `app` and `repo`; renaming a job means updating the branch ruleset.
- CI caches the LiveKit server and Rust builds; the Release workflow restores no cache, so nothing cached reaches a signed build.
- The `app` job runs on macOS, whose runners are fewer: a busy day can queue it.
- Relicensing others' contributions later would need their consent.
- Updating the pins (`mise.toml`, the locks, the actions' SHAs, the justfiles' `uvx` pins, the LiveKit server and its checksum in `livekit.just`) is the maintainer's job, done by hand.
