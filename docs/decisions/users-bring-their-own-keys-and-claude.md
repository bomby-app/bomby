# Users bring their own keys and their own Claude Code

Status: accepted, 2026-11-03

## Context

A call needs a LiveKit server, Gemini for the voice, and Claude Code for the work. Each could be bundled, proxied or brought by the user.

## Decision

The user brings exactly three things, and nothing else:

- **LiveKit API keys** for their own LiveKit Cloud project (the free tier is enough): server URL, API key, API secret. No bundled or hosted LiveKit server.
- **A Gemini API key**, entered in Settings > Credentials and stored in the keychain next to the LiveKit keys.
- **Claude Code**, installed and signed in by the user (`claude auth login`). The app runs the user's own `claude`.

We never bundle Claude Code, never ship its binary, and never build our own Claude login.

## Why

- Each account is the user's, under that provider's terms; we hold no shared keys and run no servers.
- Claude Code usage stays on the user's own plan and login, as the agent already does ([claude-over-acp-on-the-claude-plan.md](claude-over-acp-on-the-claude-plan.md)).
- Fewer moving parts: nothing to host, nothing to rotate.

## Consequences

- Settings shows each requirement as ready or missing: LiveKit keys, Gemini key, and Claude Code (found, and signed in). The adapter reports sign-in through `_auth/status_update` ([acp-notes.md](../acp-notes.md)), which the setup probe reads ([decision](check-agent-setup-with-an-acp-probe.md)), so the app can say "Run claude auth login" when it is missing.
- First run is a short setup: three keys and a signed-in Claude Code.
