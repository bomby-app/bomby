# Command palette with full-text search

Status: accepted, 2026-11-09

## Context

With several projects and many calls, the sidebar tree is slow for "the call where we talked about the reminders" or "open the terminal". The owner asked for one place, opened with ⌘K or a search button beside New project, that finds projects by name and conversations by what was said in them, and runs the app's commands, each with its shortcut shown (2026-11-09).

## Decision

- **shadcn's Command (cmdk) in a dialog**, added with `just app add command` (`components/ui/command.tsx`, `cmdk` 1.1.1). It lives in the main window (`windows/main/command-palette.tsx`), since it composes features: projects, search, to-dos, the workspace's panels, settings.
- **One query, three groups.** Commands (filtered on the page by every word in their name or keywords), Projects (by name) and Conversations (by what was said), all for the same words, so a word in a project's name and in a call both show. An empty query lists the commands and every project.
- **The core searches** (`search(query)`, `src-tauri/src/search.rs`): projects with `LIKE`, calls from an FTS5 index over `messages` with the trigram tokenizer, `remove_diacritics 1`, kept current by triggers (migration 8). A call shows once, with its first matching line cut around the match and how many lines matched; the latest calls first. cmdk's own filter is off (`shouldFilter={false}`) since the core has already chosen.
- **Commands for the open project** come from what its page has: the workspace publishes its panels and a `show(id)` that never closes one (`features/workspace/panel-requests.ts`), so Changes shows only for a repository and To-dos only when the project has the extension. Add a to-do opens only the new to-do dialog, which lives on the project's page rather than in the To-dos panel (`NewTodo` in `features/todos/todos-view.tsx`); once added, a toast says so, with Show to open the panel (owner, 2026-11-09). Project settings opens on the project's page, through a request its settings button reads (`features/projects/settings-request.ts`), and isn't offered while a call on the project replaces that page.

## Why not

- **`LIKE '%word%'` over every line**: no index, so it reads every transcript on each key press; trigrams make the same any-part-of-a-word match indexed.
- **FTS5's default `unicode61` tokenizer**: matches whole words or prefixes only, so "minders" wouldn't find "reminders", and languages without spaces between words match poorly.
- **Searching on the page**: every transcript would have to come over to the page first.

## Consequences

- The index takes about three times the text's size on disk, and the first start after the update builds it from every saved line (`rebuild`).
- A word under three characters can't use the trigram index: it still matches projects, but not conversations.
- Opening a conversation opens the call at its start; scrolling to the matching line is left for later.
