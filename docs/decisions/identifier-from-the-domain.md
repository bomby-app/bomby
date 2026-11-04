# The bundle identifier comes from the domain

Status: accepted, 2026-11-04. Replaces the identifier in [name-bomby.md](name-bomby.md).

## Context

The identifier was `com.aburady.bomby`, a person's name in reverse DNS. Bomby is meant to be open source and owned by its project, not a person.

## Decision

The identifier is `app.bomby.desktop`: the project's domain `bomby.app`, reversed, plus the product. Reverse DNS should name a domain the project owns, so not `com.bomby-app...` (that would mean `bomby-app.com`).

## Consequences

- The identifier names the app data folder (`~/Library/Application Support/app.bomby.desktop`), the log folder and the keychain service. Projects, calls and keys saved under `com.aburady.bomby` are not seen: re-enter the keys once. The old folder and keychain item can be deleted.
- Changed before any release, so no user loses data.
