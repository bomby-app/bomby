# Docs

Every doc has one job; keep it that way.

| Doc | What it is for |
| --- | --- |
| [architecture.md](architecture.md) | The pieces, how a call flows through them, and the contracts between them. Read first. |
| [roadmap.md](roadmap.md) | The build steps, their status, and what is deliberately not done yet. |
| [releasing.md](releasing.md) | How a signed, notarized release is built on GitHub, its secrets and its cost. |
| [brand.md](brand.md) | Bomby's name, logo, colours, type, mascot and voice; points at the Paper file. |
| [decisions/](decisions/) | One short record per decision: what we chose, why, and what it costs. |
| [acp-notes.md](acp-notes.md) | ACP and `claude-agent-acp` facts, checked against the installed source. |
| [livekit-notes.md](livekit-notes.md) | LiveKit Agents facts we rely on (async tools, dispatch, data to the frontend). |
| [tauri-notes.md](tauri-notes.md) | How a Tauri app fits together, and the Tauri facts we rely on (mic permissions, window, bundling, signing, updates). |
| [frontend-notes.md](frontend-notes.md) | The app's web half: shadcn, Tailwind v4, Vite+, React Compiler, Agents UI. |
| [zep-notes.md](zep-notes.md) | Zep facts for memory across calls, checked against the installed client. |
| [gemini-notes.md](gemini-notes.md) | Gemini 3.8 Live facts and caveats, checked against the plugin. |

## How we document

- **Docs change with the code.** A change that alters behavior, a contract or a command updates the matching doc in the same commit.
- **One decision, one record.** A choice someone could reasonably question gets a file in `decisions/`, named after the decision in kebab case (`desktop-app-on-tauri-v2.md`), with Status, Context, Decision and Consequences. Keep records current: fix stale names, paths and links in place. When the decision itself changes, mark the old one `Superseded by <new-record>.md` and write a new one.
- **The roadmap stays true.** When a step starts, finishes or changes, update `roadmap.md`. Pending work, tests and bug stories live in [GitHub issues](https://github.com/bomby-app/bomby/issues); the roadmap links them instead of telling them.
- **Facts carry their source.** Library and API facts go in the `*-notes.md` files with where they were checked (a URL, or a path in the installed source) and the version. These libraries move fast: re-check before relying on a note older than the pinned version.
- **Concise and informative.** Lead with the point and list facts tersely. Keep what future work needs: the fact with its source and version, and the reason behind a choice, with who made it for the owner's. Drop what no one needs again: debugging chronology, superseded attempts, plans already answered.
- **Agent instructions live in `AGENTS.md` files**, each with a `CLAUDE.md` symlink next to it (`ln -s AGENTS.md CLAUDE.md`). The root one holds what Bomby is and why, the stack and the rules for the whole repo; each part's (`agent/`, `app/`, `docs/`) holds only what matters there. Keep them short and link here for details ([decision](decisions/agent-instructions-per-folder.md)).
