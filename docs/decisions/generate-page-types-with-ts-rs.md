# Generate the page's types from the core's structs with ts-rs

Status: accepted, 2026-11-05.

## Context

The page read what the core sends through TypeScript types written by hand in each feature's `api.ts`. They drifted: a field added or renamed in a Rust struct, or in the voice agent's probe answer that the core passes on, went unnoticed until the page misread it at runtime. A review of the model picker found exactly that (owner, 2026-11-05).

## Decision

- **ts-rs writes the types from the structs** (ts-rs 12.0.1). A struct the page reads derives `ts_rs::TS` under `cfg_attr(test, ...)`, and `just app types` writes `app/src/generated/`, which is committed and imported as `@/generated/...` ([how](../tauri-notes.md#generated-types)).
- **A stale copy fails the checks.** `just app test` writes the types again to `target/` and compares them with the committed ones.
- **The probe's answer is pinned on both sides** by one fixture, `agent/tests/fixtures/probe-answer.json`: Python writes it from a real answer, Rust checks every key at every level reaches the page, and a test matches the probe's steps with the page's `Step`.
- **Not tauri-specta**, which also generates the `invoke` calls: it and specta were still release candidates (2.0.0-rc.26, rc.28). The commands stay hand-written in each `api.ts`, typed with the generated types.

## Consequences

- ts-rs is a dev-dependency and runs only in test builds: the release build, the app's size and the page bundle don't change.
- Changing a struct the page reads takes one more step: run `just app types` and commit the files.
- ts-rs ignores serde's split `rename_all`; such a struct also needs `ts(rename_all = ...)`.
