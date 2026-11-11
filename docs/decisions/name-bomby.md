# The name is Bomby

Status: accepted, 2026-11-04. Supersedes [name-claudible.md](name-claudible.md).

## Context

"Claudible" builds on "Claude", which risks reading as Anthropic's own name or catch phrase. The app is also meant to run more agents than Claude Code: many harnesses speak ACP today, and the agent now has a harness layer for them (`agent/harnesses/`).

## Decision

- The app is **Bomby**. Website `bomby.app`. Wordmark lowercase `bomby`; in sentences Bomby.
- Bundle identifier `app.bomby.desktop` ([decision](identifier-from-the-domain.md)), product name and window title `Bomby`, Rust crate `bomby`, packages `bomby-app` and `bomby-agent`, agent name `bomby` (what each call's token dispatches).
- The brand stays as it is: the mark, the mascot, the colours, type and voice in [brand.md](../brand.md).
- Claude, LiveKit and Gemini are still named only for what the app uses; never a co-brand.
- The tagline is "Say the word." ([brand.md](../brand.md)).

## Consequences

- A new identifier means a new app data folder and keychain service: projects, calls and the saved keys under `com.aburady.claudible` are not seen by Bomby. Re-enter the keys once; the old folder (`~/Library/Application Support/com.aburady.claudible`) and keychain item can be deleted.
