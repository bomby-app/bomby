# Frontend notes

The app's web half is `app/src`. Checked 2026-11-03/04 against installed shadcn CLI 4.23.0, Tailwind CSS 4.3.4, Vite+ 1.5.0, `radix-ui` 1.8.1, `cn` 0.5.2, React 19.3.1, Vite 8.3.5, shadcn docs and LiveKit docs.

## shadcn

- `just app add <name>` copies components into `src/components/ui/` without `--overwrite`; local changes survive. Refresh intentionally with `just app add --overwrite <name>`.
- `components.json` uses `style: radix-nova`: Radix primitives, Nova look, neutral colors and lucide icons ([decision](decisions/app-ui-back-on-shadcn-radix.md)).
- To change base, set `style`, regenerate every file in `components/ui` and `components/agents-ui` with `--overwrite`, then fix primitive dependencies with `bun add`/`remove`. `shadcn apply` and `init --base` also rewrite `index.css`; `migrate radix` only changes imports.
- Generated components import `cn` from the `cn` package. `src/lib/utils.ts` re-exports it for older registry code. Pin exactly while 0.5.x is new.
- shadcn data variants ignore `data-active="false"`. `init --no-pointer` keeps native arrow cursors on buttons.
- Theme tokens live in `src/index.css` (`:root`, `.dark`, `@theme inline`), using [brand.md](brand.md). Add `--claude` styling there, not in components.
- UI uses the OS font. Bricolage Grotesque Bold (`@fontsource/bricolage-grotesque/700.css`, bundled) is `font-heading` for the wordmark and headlines; no network font load.
- Sidebar: `SidebarProvider` > `Sidebar` + `SidebarInset`; Cmd+B toggles. The window's `minWidth` (820) keeps it above the 768px sheet breakpoint. Its open-state cookie is unused.
- Vite dark mode toggles `.dark` on `<html>`. Our provider also follows OS changes and sets the native window theme ([Tauri notes](tauri-notes.md#window)).

## Radix

- Compose with `asChild`, including nested tooltip and dialog triggers. `TooltipProvider` accepts `delayDuration`.
- `ToggleGroup type="single"` returns `""` when the selected item is pressed again. `Select` values are strings or `undefined`, never null; `SelectContent position="popper"` drops below the trigger.
- State attributes are `data-state` (`open`/`closed`, `on`/`off`); Agents UI and sidebar rows style against them.
- Tooltip content styles nested `Kbd`; group keys with `KbdGroup`.

## Tailwind v4

- CSS-only config: `@import "tailwindcss"` and `@tailwindcss/vite`; no `tailwind.config.js`.
- `@theme` spacing tokens create utilities, for example `--spacing-titlebar` -> `h-titlebar`.
- `@custom-variant` defines `dark` and `macos`, the latter keyed on `data-platform` in `index.html`.

## Vite+

Checked 2026-11-04 against `vite-plus` 1.5.0 (`node_modules/vite-plus/docs`, [viteplus.dev/guide](https://viteplus.dev/guide/)), which bundles Vite 8.3.5, Rolldown 1.2.16, Oxlint 1.91.0, Oxfmt 0.76.0 and `oxlint-tsgolint` ([decision](decisions/frontend-toolchain-on-vite-plus.md)).

- Project-local only: `vp` runs from `node_modules/.bin` (`bun x vp`, or `vp` inside `package.json` scripts). The global CLI is not needed and not installed.
- `app/package.json` `overrides` alias `vite` to `@voidzero-dev/vite-plus-core@<vite-plus version>` and pin `vitest` to the bundled version, so plugins share Vite+'s copies. Bump them with `vite-plus`; `bun x vp toolchain` shows the versions.
- All config is in `vite.config.ts` (`import { defineConfig } from "vite-plus"`): `lint` (Oxlint), `fmt` (Oxfmt) and the Vite build. No `.oxlintrc.json` or `.oxfmtrc.json`.
- `vp check` formats-checks, lints and type-checks (`typeAware` + `typeCheck`, through tsgolint, replacing `tsc --noEmit`; it covers `src/` and `vite.config.ts`). `just app lint` runs it with `--deny-warnings`; `just app fmt` runs `vp check --fix`.
- Lint: the `react` plugin's correctness category carries React Compiler's recommended rules (`set-state-in-effect`, `refs`, `immutability`, `preserve-manual-memoization`, ...); `react/no-deriving-state-in-effects`, `react/exhaustive-deps` and `react/rules-of-hooks` are on as errors. Disable a rule for one line with `// oxlint-disable-next-line <plugin>/<rule>` and a reason (`mascot.tsx`).
- Format: double quotes, no semicolons, ES5 trailing commas, width 80; imports sorted, Tailwind classes sorted against `src/index.css` in `cn()`/`cva()`.
- Vendor directories (`components/ui`, `components/agents-ui`, `hooks/agents-ui`, `hooks/use-mobile.ts`), `src-tauri`, `dist` and Markdown are ignored by both.
- `tsconfig.json` enables unused-local and unused-parameter checks. If generated code fails them, turn those off and use Oxlint's `no-unused-vars` instead of editing vendor files.

## React patterns

Checked 2026-11-04 against [react.dev](https://react.dev/reference/react) for React 19.3.1.

- Core data that changes by event is an external store read with `useSyncExternalStore`, with `subscribe` declared outside components and immutable snapshots (`features/agents/use-agents.ts`). Stores are per page: each window is its own page; the core stays the source of truth.
- A one-off read can be a promise in state read with `use()` under `Suspense`; refetching sets a new promise inside `startTransition`, which keeps the old rows up meanwhile (`features/setup/setup-settings.tsx`). The promise must not reject unless an error boundary is there.
- Pending states come from `useTransition` with an async action, not hand-kept `loading` flags. A `set` call after an `await` inside an action needs its own `startTransition`; store updates are synchronous anyway.
- Effects only synchronize with something outside React. Never set state synchronously in an effect (`react/set-state-in-effect`), and don't read `ref.current` during render, or pass a ref to a function during render: a closure-held value works where a value must outlive renders but not drive them (`callTokens` in `call-provider.tsx`).

## React Compiler

Checked 2026-11-04 against `@vitejs/plugin-react` 6.2.1 (installed README), `oxc-transform-react` 0.156.0, [oxc.rs/blog/2026-08-18-react-compiler-support](https://oxc.rs/blog/2026-08-18-react-compiler-support) and [react.dev/learn/react-compiler](https://react.dev/learn/react-compiler/introduction).

- `react({ compiler: true })` in `vite.config.ts` runs Oxc's Rust port of React Compiler through the optional peer `oxc-transform-react`; no Babel. Plugin 6.2.1 accepts `oxc-transform-react` `>=0.152.0 <0.157.0`; move both together.
- The plugin still labels the Rust integration experimental. Oxc reports output identical to `babel-plugin-react-compiler` across 100k+ files and about 10x faster compiles. The owner chose it over Babel (2026-11-04).
- Check it works: compiled modules contain `memo_cache_sentinel` in `dist/assets/*.js`. Opt a component out with `"use no memo"`.
- New code relies on the compiler, not `useMemo`/`useCallback`. Keep manual memoization where identity matters to an effect (React's guidance for existing code), like `finish` in `call-provider.tsx`; a value a library needs to stay the same object, like the LiveKit token source, is created once with `useState(init)`.
- A component the compiler can't optimize fails `vp check` (the rules above), so none is skipped silently.

## Agents UI

- Install with `just app add @agents-ui/<name>`. Generated code lands in `components/agents-ui/` and `hooks/agents-ui/`.
- Registry: `https://livekit.com/ui/r/{name}.json` (`components.json`). Components use our shadcn primitives through `registryDependencies`, not their own primitive library; they require `@livekit/components-react` and `livekit-client`. [Docs](https://docs.livekit.io/frontends/agents-ui/), [source](https://github.com/livekit/components-js/tree/main/packages/shadcn).
- `features/call/call-view.tsx` follows the starter's `agent-session-view-01` composition: central agent visual, overlay transcript, status, `AgentControlBar variant="livekit"` and `StartAudioButton`. Dot Dot sits over a five-bar `AgentAudioVisualizerBar` driven by `agent.microphoneTrack` and coloured with `text-primary`. The Aura visualizer was removed at the owner's request (2026-11-04).
- `saveUserChoices={false}` makes devices follow the system. livekit-client 2.23.0 captures the default device with echo cancellation, noise suppression, auto gain and voice isolation enabled.
- `useTrackVolume(track)` on the agent microphone and local participant microphone drives mascot levels.
