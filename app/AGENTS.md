# Desktop app

Tauri v2: a React frontend in `src/` and a Rust core in `src-tauri/`. `just app` lists its commands. How Tauri fits together is in [docs/tauri-notes.md](../docs/tauri-notes.md), the frontend stack in [docs/frontend-notes.md](../docs/frontend-notes.md).

## Layout

```
index.html, settings.html   one page per window; each loads src/windows/<window>/entry.tsx
public/boot.js              runs before first paint in every window: platform, theme
src/
  index.css                 Tailwind, theme tokens (light and dark), native defaults
  windows/                  one folder per window; mount.tsx wraps every window in the shared providers
    main/                   the main window: sidebar, header, main panel
    settings/               the settings window; sections.ts lists its sections
  features/<feature>/       one folder per feature: theme, credentials, projects, call, agents, setup, voice, onboarding (the first-run splash), tray (the menu bar icon's bridge to the call), notifications (finished tasks)
  components/               shared components of our own (app-logo, wordmark, mascot, titlebar-spacer, inline-link, error-card)
  components/ui/            shadcn components, from shadcn's registry
  components/agents-ui/     LiveKit Agents UI components, from LiveKit's registry
  hooks/, lib/              shared hooks and helpers (lib/utils.ts: cn; lib/store.ts: page-wide stores that mirror the core; hooks/use-core-event.ts: follow a core event while mounted)
src-tauri/src/              the Rust core: lib.rs (wiring), db.rs (SQLite, migrations), projects.rs, calls.rs, settings.rs, agents.rs (finding the agents), setup.rs (probing their setup), adapters.rs (installing ACP adapters), agent.rs (the worker), credentials.rs, windows.rs, tray.rs (the menu bar icon), notifications.rs, process.rs (waiting on child programs), sync.rs (locks that outlive a panic), app_log.rs, error.rs
src-tauri/icons/tray/       the menu bar templates, one per mascot state
src-tauri/capabilities/     what each window may call: main.json, settings.json
src-tauri/Entitlements.plist what signed builds may use under hardened runtime: the mic (docs/releasing.md)
```

## Conventions

- **A feature owns its folder.** Its components, hooks, state and core calls live in `features/<feature>/`. Other code imports what it exports; features don't reach into each other's files. Windows compose features.
- **A window owns its layout.** A new window gets a page (`<name>.html`), `src/windows/<name>/entry.tsx`, an input in `vite.config.ts`, a builder in `src-tauri/src/windows.rs`, and a capability file.
- **Settings grow by sections.** A feature exports a `<Feature>Settings` component; one entry in `windows/settings/sections.ts` (id, label, lucide icon, component) adds it to the sidebar. A section sends the user to another, and to a field there, with `useSettingsNavigation().go({ section, field })` (`lib/settings-navigation.ts`).
- **LiveKit first for calls.** Anything in a call (session, transcript, controls, visualizers, devices) uses LiveKit Agents UI and `@livekit/components-react`, following LiveKit's agent starter (`livekit-examples/agent-starter-react`). Check what LiveKit ships before building anything, and brand it from outside: props, `className`, and `data-slot` styles in `index.css` (the `.call-transcript` rules style `AgentChatTranscript` that way).
- **shadcn first.** Need a button, menu or dialog? Use shadcn's, then build ours on top.
- **Colors come from tokens.** Use the semantic classes (`bg-background`, `text-muted-foreground`, `bg-sidebar`); new colors become variables in `index.css` with light and dark values. No raw hex in components.
- **Native feel.** OS font, arrow cursor, chrome not selectable (opt in with `select-text`), tooltips after a delay, drag regions on bars. The macOS overlay title bar sets the height of the top rows: use `h-titlebar`.
- **Brand.** Colours, type, logo rules and UI copy follow [docs/brand.md](../docs/brand.md). The mark is `components/app-logo.tsx`, the wordmark `components/wordmark.tsx`; nothing else draws them. Copy follows the voice table there ("Add a folder and start talking.", not "No projects found"). Bubblegum (`bg-claude`, `Button variant="claude"`) only means Claude or an error. Links inside a sentence are `components/inline-link.tsx`. An error the user sees is `components/error-card.tsx` (the failed mascot, the message's first sentence as its headline); raw errors go to the log.
- **Talk to the core in one place per feature.** `invoke()` calls sit in a small typed module in the feature (`features/credentials/api.ts`), not scattered through components. A new command goes in `generate_handler!` (lib.rs) and `COMMANDS` (build.rs), and is granted only to the windows that need it in `src-tauri/capabilities/`.
- **Secrets stay in the core.** The page may send a secret to the core; the core never sends one back.
- **Files and names.** Kebab-case file names (`app-sidebar.tsx`), named exports, `@/` imports across folders, relative imports within one. Vite+ (Oxfmt) formats and orders imports and Tailwind classes: run `just app fmt`. All frontend tooling is configured in `vite.config.ts`.
