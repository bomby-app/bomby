# Bypass permissions for now; folders are a scope, not a fence

Status: Accepted, 2026-11-03

## Context

The shell is Claude Code's real power, and the owner wants it fully available. Claude's sandbox only restricts shell commands (file tools follow permission rules instead), and bypass mode retries sandbox-blocked commands unsandboxed, so real folder limits would mean a strict sandbox and deny rules. That is too tight to start with.

## Decision

Sessions run in `bypassPermissions` mode; the client also auto-approves any permission request that still arrives. A project's folders set Claude's working directory and extra directories, which tell Claude where the project lives, but do not stop it from going elsewhere.

## Consequences

- Claude can delete, overwrite and run anything as the user. Seen in testing: it deleted a file outright, not to the Trash, and drove a browser.
- Permission layers come later (roadmap step 5), and `ctx.foreground()` is the hook for voice approval prompts.
