# The name is Claudible

Status: superseded by [name-bomby.md](name-bomby.md), 2026-11-04: the name leaned on Claude's. Accepted 2026-11-03.

## Context

The working name was claude-livekit, and the app showed "Claude LiveKit". A product name that pairs two companies' marks reads as a joint product. Anthropic's terms bar implying a partnership or endorsement.

## Decision

- The app is **Claudible**. Website `claudible.app`. Tagline: "A voice agent that runs Claude Code. Built on LiveKit."
- The wordmark is lowercase, `claudible`; in sentences it is Claudible.
- Bundle identifier `com.aburady.claudible`, product name and window title `Claudible`, Rust crate `claudible`.
- Claude and LiveKit are named only to say what the app uses ("runs Claude Code", "built on LiveKit"). Never "Claude x LiveKit", "Claude LiveKit" or anything that reads as a co-brand or partnership.

## Why

- Renaming before anything depends on the identifier is free. After a signed release it resets macOS permissions (mic) and keychain items.
- The name says what it does (Claude, audible) without borrowing a mark as the product name.

## Consequences

- The keychain entry's service is the identifier, so credentials saved under `com.aburady.claude-livekit` are not seen by the renamed app. Re-enter them once; the old item can be deleted in Keychain Access.
- Brand rules (logo, colour, voice) live in [brand.md](../brand.md).
