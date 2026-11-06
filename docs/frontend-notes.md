# Frontend notes

The app's web half is `app/src`. Checked 2026-11-03/04 against installed shadcn CLI 4.23.0, Tailwind CSS 4.3.4, Vite+ 1.5.0, `radix-ui` 1.8.1, `cn` 0.5.2, React 19.3.1, Vite 8.3.5, shadcn docs and LiveKit docs.

## shadcn

- `just app add <name>` copies components into `src/components/ui/` without `--overwrite`; local changes survive. Refresh intentionally with `just app add --overwrite <name>`.
- `components.json` uses `style: radix-nova`: Radix primitives, Nova look, neutral colors and lucide icons ([decision](decisions/app-ui-back-on-shadcn-radix.md)).
- To change base, set `style`, regenerate every file in `components/ui` and `components/agents-ui` with `--overwrite`, then fix primitive dependencies with `bun add`/`remove`. `shadcn apply` and `init --base` also rewrite `index.css`; `migrate radix` only changes imports.
- Generated components import `cn` from the `cn` package. `src/lib/utils.ts` re-exports it for older registry code. Pin exactly while 0.5.x is new.
- `cn` merges with tailwind-merge v3's rules, which only know Tailwind's own sizes: a custom `text-label` reads as a text colour and `shadow-float` as a shadow colour, so `cn("text-label text-muted-foreground")` drops `text-label` (checked against `cn` 0.5.2, 2026-11-06). `src/lib/cn.ts` builds a `cn` with our names (`createCn` from `cn/config`, `extend.classGroups`), and `vite.config.ts` aliases the exact specifier `cn` to it, so every import gets it, generated components included. A new `--text-*` or `--shadow-*` token goes in both places; `src/lib/cn.test.ts` covers it.
- Tailwind v4 font-size tokens take `--text-<name>--line-height` and `--text-<name>--letter-spacing`; `--shadow-<name>` wins over a `--color-<name>` of the same name for `shadow-<name>` (both checked by compiling with installed Tailwind 4.3.4).
- shadcn data variants ignore `data-active="false"`. `init --no-pointer` keeps native arrow cursors on buttons.
- Theme tokens live in `src/index.css` (`:root`, `.dark`, `@theme inline`), using [brand.md](brand.md). Add `--claude` styling there, not in components.
- UI uses the OS font. Bricolage Grotesque Bold (`@fontsource/bricolage-grotesque/700.css`, bundled) is `font-heading` for the wordmark and headlines; no network font load.
- Sidebar: `SidebarProvider` > `Sidebar` + `SidebarInset`; Cmd+B toggles. The window's `minWidth` (820) keeps it above the 768px sheet breakpoint. Its open-state cookie is unused.
- Vite dark mode toggles `.dark` on `<html>`. Our provider also follows OS changes and sets the native window theme ([Tauri notes](tauri-notes.md#window)).

## Radix

- Compose with `asChild`, including nested tooltip and dialog triggers. `TooltipProvider` accepts `delayDuration`.
- `ToggleGroup type="single"` returns `""` when the selected item is pressed again. `Select` values are strings or `undefined`, never null; `SelectContent position="popper"` drops below the trigger.
- State attributes are `data-state` (`open`/`closed`, `on`/`off`); Agents UI and sidebar rows style against them.
- `Collapsible` (Settings, Agents rows) animates with tw-animate-css's `animate-collapsible-down`/`-up`, which read `--radix-collapsible-content-height`.

## Combobox

- shadcn's radix-nova Combobox is built on Base UI (`@base-ui/react` 1.9.0), not Radix (`bun x shadcn view combobox`, checked 2026-11-05). The model picker's searchable setting uses its pop-up form: a `ComboboxTrigger` rendered as a `Button`, with `ComboboxInput showTrigger={false}` inside `ComboboxContent` ([shadcn](https://ui.shadcn.com/docs/components/radix/combobox#popup), [Base UI](https://base-ui.com/react/components/combobox#input-inside-popup)).
- Base UI highlights an item only on hover or arrow keys: `autoHighlight` (the first match while filtering) is off by default. The highlighted item carries `data-highlighted`.
- Object items: `itemToStringLabel` names them, `isItemEqualToValue` compares them (default `Object.is`), `filter(item, query)` replaces the default match. Groups are `{ value, items }` objects, rendered with `ComboboxGroup items` and `ComboboxCollection`.
- `ComboboxContent` limits itself to `--available-height` and `--available-width`, so it never runs out of the window.
- Tooltip content styles nested `Kbd`; group keys with `KbdGroup`.

## Tailwind v4

- CSS-only config: `@import "tailwindcss"` and `@tailwindcss/vite`; no `tailwind.config.js`.
- `@theme` spacing tokens create utilities, for example `--spacing-titlebar` -> `h-titlebar`.
- `@custom-variant` defines `dark` and `macos`, the latter keyed on `data-platform` in `index.html`.

## Vite+

Checked 2026-11-04 against `vite-plus` 1.5.0 (`node_modules/vite-plus/docs`, [viteplus.dev/guide](https://viteplus.dev/guide/)), which bundles Vite 8.3.5, Rolldown 1.2.16, Oxlint 1.91.0, Oxfmt 0.76.0 and `oxlint-tsgolint` ([decision](decisions/frontend-toolchain-on-vite-plus.md)).

- Project-local only: `vp` runs from `node_modules/.bin` (`bun --bun x vp`, or `vp` inside `package.json` scripts run with `bun --bun run`). The global CLI is not needed and not installed.
- Always on Bun, with `--bun`: `vp`, Vitest and the Tauri CLI start with `#!/usr/bin/env node`, which `bun x` and `bun run` follow without it, so they'd run on whatever Node the machine has (none is pinned; CI's runner has its own). With `--bun`, `vp check`, `vp test`, `vp build` and `tauri` run on the pinned Bun with no Node on PATH (checked with Bun 1.4.4, vite-plus 1.5.0, 2026-11-06).
- `app/package.json` `overrides` alias `vite` to `@voidzero-dev/vite-plus-core@<vite-plus version>` and pin `vitest` to the bundled version, so plugins share Vite+'s copies. Bump them with `vite-plus`; `bun --bun x vp toolchain` shows the versions.
- All config is in `vite.config.ts` (`import { defineConfig } from "vite-plus"`): `lint` (Oxlint), `fmt` (Oxfmt) and the Vite build. No `.oxlintrc.json` or `.oxfmtrc.json`.
- `vp check` formats-checks, lints and type-checks (`typeAware` + `typeCheck`, through tsgolint, replacing `tsc --noEmit`; it covers `src/` and `vite.config.ts`). `just app lint` runs it with `--deny-warnings`; `just app fmt` runs `vp check --fix`.
- `vp test` runs Vitest 5.1.0, bundled with Vite+: tests import from `vite-plus/test`, and the config is the `test` block in `vite.config.ts` (Vite+ advises against a `vitest.config.ts`). It runs once and exits; `vp test watch` stays on ([guide](https://viteplus.dev/guide/test), vite-plus 1.5.0). Our tests are `src/**/*.test.ts`, the page's own logic in Node with no DOM, like the splash's steps (`features/onboarding/splash-step.ts`); `just app test` runs them.
- Lint: the `react` plugin's correctness category carries React Compiler's recommended rules (`set-state-in-effect`, `refs`, `immutability`, `preserve-manual-memoization`, ...); `react/no-deriving-state-in-effects`, `react/exhaustive-deps` and `react/rules-of-hooks` are on as errors. Disable a rule for one line with `// oxlint-disable-next-line <plugin>/<rule>` and a reason (`mascot.tsx`).
- Format: double quotes, no semicolons, ES5 trailing commas, width 80; imports sorted, Tailwind classes sorted against `src/index.css` in `cn()`/`cva()`.
- Vendor directories (`components/ui`, `components/agents-ui`, `hooks/agents-ui`, `hooks/use-mobile.ts`), `src-tauri`, `dist` and Markdown are ignored by both.
- `tsconfig.json` enables unused-local and unused-parameter checks. If generated code fails them, turn those off and use Oxlint's `no-unused-vars` instead of editing vendor files.

## React patterns

Checked 2026-11-04 against [react.dev](https://react.dev/reference/react) for React 19.3.1.

- Core data that changes by event is an external store read with `useSyncExternalStore`, with `subscribe` declared outside components and immutable snapshots (`features/agents/use-agents.ts`, `features/credentials/use-saved-keys.ts`, which holds only whether each key exists). Stores are per page: each window is its own page; the core stays the source of truth.
- Prefer such a store over a promise read with `use()` for data a section shows each time it opens: a section remounts on every visit, a new promise suspends it again, and React holds a shown Suspense fallback for at least 300ms (`FALLBACK_THROTTLE_MS` in `react-dom` 19.3.1), so it flashes even when the core answers at once (`features/credentials/use-saved-keys.ts`). A store keeps the last answer.
- Pending states come from `useTransition` with an async action, not hand-kept `loading` flags. A `set` call after an `await` inside an action needs its own `startTransition`; store updates are synchronous anyway.
- Effects only synchronize with something outside React. Never set state synchronously in an effect (`react/set-state-in-effect`), and don't read `ref.current` during render, or pass a ref to a function during render: a closure-held value works where a value must outlive renders but not drive them (`callTokens` in `call-provider.tsx`).

## Animated gradients

- A gradient can't transition by itself; its numbers can. `components/day-glow.css` registers each one with `@property` (`<percentage>`, `<number>`, `<color>`, `inherits: false`) and builds the `radial-gradient` from them, with each stop's alpha from `color-mix(in oklab, <color> calc(<alpha> * 100%), transparent)`. A new `data-stage` then transitions smoothly. Tailwind v4 relies on `@property` too, so the webview supports it.
- `in oklab` interpolation inside the gradient itself is left out: every stop shares one hue, and a declaration the webview didn't parse would drop the glow.

## Actions

- A one-off async action with its own error, like the splash's Paste all, is a React 19 `useActionState(action, null)`: the action returns the error message or null, a `<form action={...}>` runs it, and its pending flag disables the button. Longer flows (Check again, leaving the splash) use `useTransition` with an async function.
- Form fields are uncontrolled, not drafts in state: `name` plus `defaultValue`, read from `FormData` in the action (Project settings' and New project's instructions) or from the field itself (`components/inline-edit-input.tsx`). A copy of the text in state lags a render behind the field, so a save in the same event reads the old text (Esc saved the name it cancelled), and syncing it from props can overwrite typing.
- After an action succeeds, React resets the form's uncontrolled fields to their `defaultValue` (react.dev `<form>`, React 19.3.1, read 2026-11-05). An action that returns an error instead of throwing has succeeded, so it clears what was typed: return the typed text in the action's state and remount the field with a `key` per attempt, with that text as its `defaultValue`. A button outside the form joins it with `form="<id>"`; disable the field while the action is pending so nothing typed then is lost.

## GSAP

- The splash runs on one GSAP timeline (`gsap` 3.15.0, `@gsap/react` 2.1.2; 3.15.1 was a day old). Checked 2026-11-05 at gsap.com/resources/React and gsap.com/docs/v3/GSAP/Timeline.
- `useGSAP()` replaces `useEffect`: animations made while it runs join a `gsap.context()` and revert on unmount (and on StrictMode's double run). Register it once with `gsap.registerPlugin(useGSAP)`. `{ dependencies, scope }` reruns it; animations made later, in handlers or timeouts, need `contextSafe()` to be cleaned up.
- React Compiler's refs rule rejects `contextSafe(...)` called during render on a function that reads a ref. The splash's fade out finishes before it unmounts, so it is a plain handler.
- The position parameter orders the steps: `">"` after the previous one, `"<"` with it, `"+=2.4"` a gap. `autoAlpha` fades opacity and sets `visibility`, so elements start `invisible`.
- Positions are fixed (absolute, from the window's middle) and only transforms move, so nothing reflows mid-animation. Motion's `layout` animations made the mascot swing around the text (2026-11-05), so the splash doesn't use them.

## Splash sound

- WKWebView plays audio without a user gesture here: wry 0.57.1 sets `mediaTypesRequiringUserActionForPlayback` to none when `autoplay` is on, its default (`src/wkwebview/mod.rs`, `WebViewAttributes::default`), and Tauri 2.12 doesn't turn it off. The splash calls `new Audio(...).play()` on mount.

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
