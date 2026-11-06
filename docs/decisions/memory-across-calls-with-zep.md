# Memory across calls, with Zep

Status: accepted, 2026-11-06.

## Context

Bomby forgot the user between calls: resuming a call replays its last 50 lines ([decision](resume-a-call-with-its-last-lines.md)), but a new call starts from nothing. The owner wanted Bomby to remember the user and their work, following how another of the owner's voice agents does it with Zep.

## Decision

- **Opt in, in Settings, Memory** (owner, 2026-11-06): one switch, "Remember me across calls", off by default. It's separate from resuming, which keeps replaying a call's last lines either way.
- **The user's own Zep project and key**, kept in the keychain like the other keys. Without a saved key, calls don't remember across conversations even when the switch is on.
- **One Zep user per install**, an id the core makes once (`memory_user` in `settings`), with the user's name from Settings, Bomby and the Mac's time zone, kept current at each call's start, so Zep's facts and summary call the user by name, or by nothing when they gave none (owner, 2026-11-06). A call gets a new Zep thread when it has something to save.
- **Read before Gemini connects, within 5 seconds** (owner, 2026-11-06), while the room connects: Zep's summary of the user and up to 20 facts still true go into the voice prompt under `## What you remember`; Gemini Live's instructions are final once it connects. Nothing is seeded for a user Zep knows too little about yet, and a summary counts only once there are facts.
- **Zep down never fails a call**: a call that can't reach Zep in time has no memory, and the app shows the failed mascot with "I have no memory!" (owner's words, 2026-11-06), from the agent's `bomby.memory` attribute; the same happens when saving or recalling fails mid-call. Gemini isn't told: it never sees the recall tool on such a call, and a line about a tool it doesn't have would only confuse it (owner).
- **Mid-call**, the `recall_about_user` tool searches the facts; it's registered only for calls with memory.
- **Saved in the background, every line in the order it was said**, as Zep asks: spoken and typed lines alike, from LiveKit's conversation items, sorted by when each was said (Gemini finalises the user's line after its reply), one batch at a time, a failed one tried again once. Bomby's lines give context but aren't mined for facts. Nothing is sent, not even a thread, until the user says something; Bomby cut off after a word or two is left out. On hang-up the agent waits for the session to close, then saves the rest, a line the user never finished too, within LiveKit's shutdown time ([notes](../livekit-notes.md#the-conversation-for-memory)).
- **Incognito**, a second switch in Settings, Memory, as in the owner's other agent: calls still read memory but save nothing. The agent creates nothing in Zep, not the user, a thread or a profile update, and never attaches the listener that saves, so nothing can be saved by accident. Like every setting, it applies from the next call.
- **The key rides with the worker, the switches with each call**: the worker gets `ZEP_API_KEY` whenever a key is saved, since a change to its environment means a restart; the call's metadata (`memory_user`, `memory_incognito`) turns memory on. The key can't go in the metadata: it travels in the LiveKit token, which the server reads. Coding agents never see it: the runner strips it from every harness.

## Consequences

- The user brings one more key, only if they want memory.
- What the user says in calls goes to their Zep project, which the switch and its description make clear.
- Zep failing or unreachable leaves the call working without memory.
