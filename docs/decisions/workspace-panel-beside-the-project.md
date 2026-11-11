# Workspace panel beside the project

Status: accepted, 2026-11-07

## Context

While an agent works, the user wants to see what it's doing to their folder without leaving Bomby: the git changes as they happen, the files, and a shell of their own. Other desktop agents (ChatGPT's and Codex's apps) put this in a resizable panel on the right (owner, 2026-11-07). It has to come from libraries that are maintained, widely used, and bundle into a signed macOS app without trouble.

## Decision

- **A panel on the right of a project's page**, its live call and its past calls, toggled from the header or with ⌘J, dragged wider at its edge (shadcn `Resizable`, `react-resizable-panels` v4). It exists only for a project with folders, and shows one of them at a time, picked at its top when there are several (owner, 2026-11-07). The three views share one layout, so moving between the project and its call keeps the panel and its terminals.
- **Independent panels, as in the Claude app (owner, 2026-11-08).** Changes, Files, Terminal and each extension's panel (To-dos, [decision](extensions.md)) each have a toggle in the project's header and open on their own, each with its own header: its name, its actions (Terminal's tabs and +, the folder picker), expand and close. Several open stack in the right-hand column, dragged taller or shorter against each other; the column shows while any is open. A project without folders has its extensions' panels alone. Changes is there for a folder outside git too, where it says so and its folder picker still chooses another of the project's folders (owner, 2026-11-11). The header puts the page's own actions first, then the toggles, then its main action (Call, Resume) on its own at the right end. This replaced one strip of tabs for everything (owner, 2026-11-07), which mixed unrelated views.
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

- Each panel loads the first time it opens, not with the window: Changes and Files bring Pierre with Shiki's grammars and read the folder's diff, Terminal brings wterm and its 600 KB WASM. Closed, Changes, Files and To-dos leave the column and read again from the cache when they return; the terminals stay mounted out of sight, so they keep running.
- Closing Terminal keeps its terminals running; leaving the project, or closing a terminal's tab, hangs up its shell (SIGHUP to its process group, SIGKILL a second later). Quitting the app closes them all.
- Changes are against the last commit; untracked files are told apart from added ones and conflicts show as such, but staged and unstaged edits aren't yet. Files fold one by one or all at once. Files bigger than 1 MB show as changed without their lines, and patches stop at 4 MB in all.
- Pierre's themes paint their own background; `unsafeCSS` puts ours back ([frontend notes](../frontend-notes.md#workspace-panel)), and Pierre doesn't promise that hook across versions.
