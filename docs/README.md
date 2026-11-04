# Docs

Start here. Every doc has one job; keep it that way.

| Doc | What it is for |
| --- | --- |
| [architecture.md](architecture.md) | The pieces, how a call flows through them, and the contracts between them. Read first. |
| [roadmap.md](roadmap.md) | The build steps, their status, and what is deliberately not done yet. |
| [decisions/](decisions/) | One short record per decision: what we chose, why, and what it costs. |
| [acp-notes.md](acp-notes.md) | ACP and `claude-agent-acp` facts, checked against the installed source. |
| [livekit-notes.md](livekit-notes.md) | LiveKit Agents facts we rely on (async tools, dispatch, data to the frontend). |
| [gemini-notes.md](gemini-notes.md) | Gemini 3.8 Live facts and caveats, checked against the plugin. |
| [gemini-capabilities-guide.md](gemini-capabilities-guide.md) | Google's Live API guide, downloaded as reference. Not ours; don't edit. |

## How we document

- **Docs change with the code.** A change that alters behavior, a contract or a command updates the matching doc in the same commit.
- **One decision, one record.** A choice someone could reasonably question gets a file in `decisions/`, named after the decision in kebab case (`desktop-app-on-tauri-v2.md`), with Status, Context, Decision and Consequences. Never rewrite an old record: mark it `Superseded by <new-record>.md` and write a new one.
- **The roadmap stays true.** When a step starts, finishes or changes, update `roadmap.md`.
- **Facts carry their source.** Library and API facts go in the `*-notes.md` files with where they were checked (a URL, or a path in the installed source) and the version. These libraries move fast: re-check before relying on a note older than the pinned version.
- **Short and plain.** Lead with the point. No filler sections, no em dashes.
- **`CLAUDE.md` is the entry point for agents.** It stays short: what the project is, the rules, and links into these docs. Details live here, not there.
