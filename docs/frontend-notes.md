# Frontend notes

The app's web half is `app/src`. Checked 2026-11-03/04 against installed shadcn CLI 4.23.0, Tailwind CSS 4.3.4, Biome 2.6.4, `radix-ui` 1.8.1, `cn` 0.5.2, React 19, Vite 8, shadcn docs and LiveKit docs.

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

## Biome

- `biome.json`, `just app lint` and `just app fmt` cover format, lint and import order in shadcn style.
- Vendor directories (`components/ui`, `components/agents-ui`, `hooks/agents-ui`, `hooks/use-mobile.ts`) are excluded from lint and formatting.
- `tsconfig.json` enables unused-local and unused-parameter checks. If generated code fails them, move unused-code checks to Biome rather than editing vendor files.
- Tailwind class sorting remains off because Biome 2.6's rule is nursery.

## Agents UI

- Install with `just app add @agents-ui/<name>`. Generated code lands in `components/agents-ui/` and `hooks/agents-ui/`.
- Registry: `https://livekit.com/ui/r/{name}.json` (`components.json`). Components use our shadcn primitives through `registryDependencies`, not their own primitive library; they require `@livekit/components-react` and `livekit-client`. [Docs](https://docs.livekit.io/frontends/agents-ui/), [source](https://github.com/livekit/components-js/tree/main/packages/shadcn).
- `features/call/call-view.tsx` follows the starter's `agent-session-view-01` composition: central agent visual, overlay transcript, status, `AgentControlBar variant="livekit"` and `StartAudioButton`. Dot Dot sits over a five-bar `AgentAudioVisualizerBar` driven by `agent.microphoneTrack` and coloured with `text-primary`. The Aura visualizer was removed at the owner's request (2026-11-04).
- `saveUserChoices={false}` makes devices follow the system. livekit-client 2.23.0 captures the default device with echo cancellation, noise suppression, auto gain and voice isolation enabled.
- `useTrackVolume(track)` on the agent microphone and local participant microphone drives mascot levels.
