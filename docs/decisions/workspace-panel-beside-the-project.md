# Workspace panel beside the project

Status: accepted, 2026-11-07

## Context

While an agent works, the user wants to see what it's doing to their folder without leaving Bomby: the git changes as they happen, the files, and a shell of their own. Other desktop agents (ChatGPT's and Codex's apps) put this in a resizable panel on the right (owner, 2026-11-07). It has to come from libraries that are maintained, widely used, and bundle into a signed macOS app without trouble.

## Decision

- **A panel on the right of a project's page**, its live call and its past calls, toggled from the header or with ⌘J, dragged wider at its edge (shadcn `Resizable`, `react-resizable-panels` v4). It exists only for a project with folders, and shows one of them at a time, picked at its top when there are several (owner, 2026-11-07). The three views share one layout, so moving between the project and its call keeps the panel and its terminals.
- **Tabs: Changes, Files, an extension's tabs, terminals.** Changes shows only when the folder is in a git repository; Files and terminals are there for any folder (owner, 2026-11-07). An extension can add a tab, with a button of its own in the header that opens the panel on it (To-dos, [decision](extensions.md)); a project without folders gets the panel for those tabs alone (owner, 2026-11-08).
- **Changes: libgit2 in the core, Pierre's diffs on the page.** `git2` with `vendored-libgit2` diffs HEAD against the working tree (index included, new files too, ignored files out), each file as its own unified patch; `@pierre/diffs`'s `CodeView` renders them, virtualized, with sticky file headers and Shiki highlighting. libgit2 is built into the app, so the user needs no git (and macOS never prompts for the developer tools).
- **Terminals: portable-pty in the core, wterm with the Ghostty core on the page.** `portable-pty` (WezTerm's) runs the user's login shell (`$SHELL -l`) on a pseudo-terminal; its bytes stream to the page over a Tauri channel, raw. `@wterm/react` draws them as DOM text, so selection, copy and find are the system's own, on `@wterm/ghostty` (libghostty's VT parser built to WASM) for full emulation: the "Ghostty shell" the owner asked for.
- **Files: our own tree** on the core's directory listing, one directory at a time, ignored entries dimmed, changed files marked with their git status, a file's text previewed read-only with Pierre's `File`. Editing is left out to keep the panel safe while agents write the same files (owner, 2026-11-07).
- **Live.** The core watches the shown folder, and its repository's git folders when they're elsewhere (`notify`, FSEvents, debounced 300 ms; in git's folders only the index, HEAD and the branches count), and the page reads again what it shows.
- **The core checks every path.** Each command names a project and one of its folders, which must be the project's and still there; paths inside stay inside, symlinks included, and the core reads the real path it checked (`src-tauri/src/workspace/mod.rs`). A program swapping a folder above the file between the check and the read could still win; opening every file relative to a held folder handle would close that, but only such a program, running as the user and able to read the file anyway, could, and the preview only shows the user their own files (owner, 2026-11-07, on Greptile's review).

## Why not

- **xterm.js**: the most used web terminal, but canvas-drawn, and the owner wanted Ghostty's. wterm is Vercel's, active (several releases a week in 2026-11), and its docs check Vite builds of the Ghostty core.
- **ghostty-web** (Coder): xterm.js-compatible, but no release since 2025-12.
- **`tauri-plugin-pty`**: a thin wrapper on portable-pty that calls itself in development, with a failing CI run on its latest commit. The core's own 250 lines on portable-pty are ours to fix.
- **The `git` program**: needs Xcode's command line tools on a fresh Mac, and its output depends on the user's git config.
- **`@pierre/trees`**: a 1.0 beta on a Preact beta; a tree of rows is little code.
- **gix**: pure Rust, but turning its worktree status into unified patches is ours to write; git2 prints them.

## Consequences

- Each tab loads the first time it shows, not with the window or the panel: Changes and Files bring Pierre with Shiki's grammars and read the folder's diff, a terminal brings wterm and its 600 KB WASM. Until then the panel only watches the folder and asks whether it's in a repository. A tab that has shown stays mounted, hidden, so terminals keep running (owner, 2026-11-08: opening the panel for another tab shouldn't pay for these).
- Closing the panel keeps its terminals running; leaving the project, or closing a terminal's tab, hangs up its shell (SIGHUP to its process group, SIGKILL a second later). Quitting the app closes them all.
- Changes are against the last commit; untracked files are told apart from added ones and conflicts show as such, but staged and unstaged edits aren't yet. Files fold one by one or all at once. Files bigger than 1 MB show as changed without their lines, and patches stop at 4 MB in all.
- Pierre's themes paint their own background; `unsafeCSS` puts ours back ([frontend notes](../frontend-notes.md#workspace-panel)), and Pierre doesn't promise that hook across versions.
