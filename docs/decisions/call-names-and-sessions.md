# Call names, and a call's sessions

Status: accepted, 2026-11-09

## Context

Calls showed only when they started ("Today, 21:40"), so finding one meant opening several. The owner wants each call to have a name: Bomby names it once it knows what the call is about, and the user renames it at any time, as with to-dos (owner, 2026-11-09).

A call can be resumed later ([decision](resume-a-call-with-its-last-lines.md)), but resuming reopened the same call row and kept nothing of when each stretch ran: the transcript ran together, and a call's length counted the hours between stretches. The owner wants the stretches told apart in the transcript, with dividers that say when each started and fold its lines away (owner, 2026-11-09).

## Decision

- **A call has a name, its own data.** `calls.name` and `calls.named_by` (`user` or `bomby`), null until named; saving no words takes the name away, so the call shows when it started again. A name is one line, at most 60 characters. `rename_call(callId, name, by)` in the core sends `call-renamed` to every window. The user renames a call from its title in the header and from the Rename button on its row in the project's calls, whether the extension is on or not. Its start time stays: under the name in the calls list, beside it in the command palette and on hover in the sidebar.
- **Bomby's side is an extension**, Call names (`agent/extensions/call_names.py`, on by default), built like To-dos ([decision](extensions.md)): one tool, `name_call(name)`, which asks `bomby.call_names.set` over RPC; the page renames the call it's on, as `bomby`. The call starts knowing its name (`{name, namedBy}`), so a resumed call isn't named again for nothing. Off, Bomby neither sees nor sets the name.
- **The note is one sentence**: name the call once you know what it's about, in a few words, plus its name if it has one. No rules about renaming or the user's own names: the voice model has a lot on its plate (owner, 2026-11-09).
- **A session is one stretch of a call**, from opening or resuming it to its end (`call_sessions`), and each transcript line keeps the session it was said in (`messages.session_id`). `open_call` begins one, also on resume; `end_call` ends it; a line saved just after the end joins the call's latest. A session the app quit during ends at its last line when the call resumes. `calls.started_at` stays the call's first start.
- **Dividers between sessions.** A saved call with more than one session shows a divider over each ("Started Today, 21:40 · 12 min", "Resumed Yesterday, 09:05 · 4 min") that folds its lines, all open. On a resumed live call, the earlier sessions show folded above the live lines, which have no divider of their own. A call with one session looks as before.
- **Order stays by start.** Calls stay newest first by when they started, so resuming one doesn't move it in the tree; projects stay by name in the sidebar and by their newest call on the projects home and in the menu bar (owner, 2026-11-09).

## Why

- **Our own session row, not a LiveKit id.** Each token gets a new room name, reconnects included, so no LiveKit id marks a stretch of the call. The core already knows when one begins and ends, and it saves every line, so it stamps each line itself; neither the page nor the agent changes.
- **The name on the call, the tool in an extension.** The user renames calls with every extension off; only Bomby's part is optional.
- **The dividers are ours, from Agents UI's parts.** `AgentChatTranscript` (from LiveKit's registry) maps a flat list with no room for a divider; `SessionTranscript` builds the same transcript from the same parts (`MessageScroller`, `Message`, `Bubble`, `Marker`), so the bubbles look the same and the registry's file stays untouched.

## Consequences

- Calls from before this have one session holding all their lines: earlier resumes left nothing to split them by.
- A call's length is its sessions added up (`activeMs`), not from its first start to its last end.
- The sessions are where resuming the coding agents' sessions in a later call can hang (roadmap step 4).
- The command palette finds calls by name too, any part, any case, short words included.
