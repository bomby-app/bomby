# Locks that can't be taken twice

Status: accepted, 2026-11-11 (owner asked that the 0.3.2 launch hang can't ship silently again).

## Context

Bomby 0.3.2 hung at launch with a blank window. The core's database is one connection behind a std `Mutex`, and `Db::conn()` handed out its guard. A guard made as a temporary inside a bigger expression lives to the end of the statement (or of the block's tail expression; edition 2024 didn't change that for struct-literal fields or arguments), so a struct literal with two fields that each called `db.conn()` waited on itself forever. std's `Mutex` isn't re-entrant and says nothing when a thread locks one it holds. The launch look, an agent's recheck after a key was saved and `call_token` for a call this run didn't open all had that shape. Three reviews read past it; nothing ran it.

## Decision

- **The locks every part of the core shares are `sync::Exclusive`** (`src-tauri/src/sync.rs`): a lock that records, per thread, which of them that thread holds. Taking one the thread already holds fails at once instead of waiting: it panics in debug builds and tests, so the test that reaches it fails, and it returns `Error::Reentered` in a release, so the command fails with a message and the app goes on. The database (`Db`) and the vault's two locks (`keys` and `keychain`, `credentials.rs`) are.
- **`Db::conn()` returns a `Result`**, so every caller handles that failure. The convention is to take the connection once in a `let` and pass `&Connection` down; a function that needs the database and something slow (a probe, the keychain) reads, lets go, then does the slow thing.
- **The paths that hung run in tests against a real in-memory database**, through Tauri's mock runtime (`tauri::test`, `src-tauri/src/testing.rs`): the launch look's reads and records (`agents::look_reads`, `record_check`), an agent's recheck with the probe answered by the test (`agent_picks::recheck_with`), and `call_token` for a call the core doesn't hold (`calls::token_for`). Each fails at once if the shape comes back.
- **A lock held long can't freeze the app either**: every command that takes one runs on the blocking pool, not the async runtime's workers ([tauri-notes.md](../tauri-notes.md#windows-and-commands)), and no lock but the keychain's is held across a keychain call.
- Rejected: a closure API (`db.with(|conn| ..)`) alone. It stops a guard outliving a statement, but not a closure that calls something that takes the database again; the per-thread check catches both.

## Consequences

- A re-entry is a bug report with a message, not a hang. In a release it's still a failed command, so tests are where it must be caught.
- The check costs a thread-local lookup per lock, nothing next to a SQLite query.
- `Exclusive` doesn't see a lock taken on another thread that waits on this one (a deadlock across threads); keeping slow work outside the lock is still the rule.
