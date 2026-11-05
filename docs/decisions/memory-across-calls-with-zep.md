# Memory across calls, with Zep

Status: accepted, 2026-11-06.

## Context

Bomby forgot the user between calls: resuming a call replays its last 50 lines ([decision](resume-a-call-with-its-last-lines.md)), but a new call starts from nothing. The owner wanted Bomby to remember the user and their work, following how another of the owner's voice agents does it with Zep.

## Decision

- **Opt in, in Settings, Memory** (owner, 2026-11-06): one switch, "Remember me across calls", off by default. It's separate from resuming, which keeps replaying a call's last lines either way.
- **The user's own Zep project and key**, kept in the keychain like the other keys. Without a saved key, calls don't remember across conversations even when the switch is on.
- **One Zep user per install**, an id the core makes once (`memory_user` in `settings`); each call opens a new Zep thread for that user.
- **Read before Gemini connects**: Zep's summary of the user and up to 20 facts still true go into the voice prompt under `## What you remember`; Gemini Live's instructions are final once it connects. Nothing is seeded for a user Zep knows too little about yet.
- **Mid-call**, the `recall_about_user` tool searches the facts; it's registered only for calls with memory.
- **Writes in the background**, one exchange per final user transcript (Bomby's line before it gives context but isn't stored as a fact about the user), and the last unfinalised line on hang-up.
- **Incognito**, a second switch in Settings, Memory, as in the owner's other agent: calls still read memory but save nothing. The agent opens no Zep thread and never attaches the write listener, so nothing can be saved by accident. Like every setting, it applies from the next call.
- **Coding agents never see the key**: the worker gets `ZEP_API_KEY` only when memory is on, and the runner strips it from every harness.

## Consequences

- The user brings one more key, only if they want memory.
- What the user says in calls goes to their Zep project, which the switch and its description make clear.
- Zep failing or unreachable leaves the call working without memory.
