# Frontend notes

The app's web half (`app/src`). Checked against shadcn CLI 4.23.0, Tailwind CSS 4.3.4, Biome 2.6.4, `@base-ui/react` 1.9.0, `cn` 0.5.2, React 19 and Vite 8 (installed in `app/node_modules`), ui.shadcn.com docs (sources in `shadcn-ui/ui` `apps/v4/content/docs`), and docs.livekit.io, 2026-11-03.

## shadcn

- **Components are copied in, not installed.** `just app add <name>` runs the shadcn CLI, which writes the source to `src/components/ui/`. We treat it as generated: style it through props and `className` from our components. The recipe passes `--overwrite` (otherwise the CLI stops to ask about any file Biome reformatted), so `add` refreshes shared files like `separator.tsx` from the registry, and a hand edit there would be lost.
- **Base and style.** `components.json` has `style: base-nova`: Base UI primitives (`@base-ui/react`), the Nova look, neutral colors, lucide icons. Base UI is the CLI default (`--base base`); it also offers Radix and React Aria. See [decision](decisions/app-ui-on-shadcn-base-ui.md).
- **Changing base.** Set `style` in `components.json`, then `just app add` every component in `components/ui` to regenerate them. The CLI may not add the new primitive package when it only overwrites files; add it with `bun add`.
- **`cn` is a package now.** Generated components `import { cn } from "cn"` (published by shadcn; replaces `clsx` plus `tailwind-merge`). `src/lib/utils.ts` re-exports it for older registry code that imports `@/lib/utils`. Pinned to an exact version because 0.5.x is new.
- **Data variants.** shadcn's `data-active:` and friends (`shadcn/tailwind.css`) skip `data-active="false"`, so `isActive={false}` is safe.
- **`init` with `--no-pointer`** keeps the default arrow cursor on buttons, as native apps do.
- **Theme tokens** are CSS variables in `src/index.css` (`:root` light, `.dark` dark, mapped into Tailwind with `@theme inline`), set to the Claudible palette from [brand.md](brand.md). We added `--claude` / `--claude-foreground` (`bg-claude text-claude-foreground`) for anything that means Claude. Change colours there, not in components.
- **Fonts.** UI text is the OS font (`font-sans`). `font-heading` is Bricolage Grotesque, Bold only (`@fontsource/bricolage-grotesque/700.css`, bundled, no network): the wordmark (`components/wordmark.tsx`) and headlines. shadcn's Empty and Sheet titles use `font-heading`, so they get it too.
- **Sidebar** (`ui/sidebar.tsx`): `SidebarProvider` > `Sidebar` (`variant` sidebar, floating or inset; `collapsible` offcanvas, icon or none) + `SidebarInset`. Cmd+B toggles it. Below 768px it turns into a sheet; the window's `minWidth` (820) keeps us above that. Its open-state cookie is for server rendering and does nothing here.
- **Dark mode on Vite** is a provider that toggles `.dark` on `<html>` (shadcn docs, `dark-mode/vite`). Ours also follows OS changes while on "system" and sets the native window theme; see [tauri-notes.md](tauri-notes.md#window).

## Base UI

- Composition uses `render`, not `asChild`: `<TooltipTrigger render={<Button variant="ghost" />}>`.
- `TooltipProvider` takes `delay` (ms), not `delayDuration`.
- `ToggleGroup` has `value` and `onValueChange` as arrays (`multiple` for more than one); a single choice is `value={[theme]}`, and pressing the selected item again empties the array.
- `Kbd` inside `TooltipContent` is styled by the tooltip itself (`**:data-[slot=kbd]`); group keys with `KbdGroup` (shadcn docs, `components/base/kbd`, example `kbd-tooltip`).

## Tailwind v4

- Configured in CSS, no `tailwind.config.js`: `@import "tailwindcss"` plus the `@tailwindcss/vite` plugin.
- `--spacing-<name>` in `@theme` makes size utilities: `--spacing-titlebar` gives `h-titlebar`.
- `@custom-variant` adds variants: `dark` (shadcn) and our `macos`, keyed on `data-platform` set in `index.html`.

## Biome

- One tool for format, lint and import order (`biome.json`, `just app lint` / `just app fmt`). Its formatter is set to match shadcn's output (double quotes, no semicolons, ES5 trailing commas, 80 columns), so formatting generated files only reorders imports.
- Linting is off for `src/components/ui/**` and `src/hooks/use-mobile.ts` (generated); formatting still applies.
- Tailwind class sorting (`useTailwindSortedClasses`) is a nursery rule in 2.6, so it's off.

## Agents UI

- Installed with `just app add @agents-ui/<name>`: `agent-session-provider`, `agent-control-bar`, `agent-chat-transcript`, `agent-audio-visualizer-bar` and what they pull in. Files land in `src/components/agents-ui/` and `src/hooks/agents-ui/`; like `components/ui`, they are generated (Biome lints them off).
- **Two hand fixes for Base UI**, marked `// Base UI:` in the files, needed because Agents UI was written against Radix's Select and Toggle: `agent-track-control.tsx` (`onValueChange` gets `string | null`; `SelectContent` has no `position="popper"`, use `alignItemWithTrigger={false}`) and `agent-track-toggle.tsx` (its props omit the button's `value`). Any `just app add` that pulls these in (the control bar, the session view block) overwrites them; redo the fixes after.
- **Unused `React` imports.** Registry code writes `import React, { ... }` without using `React`, which `noUnusedLocals` rejects. `app/scripts/clean-generated.sh` (run by `just app add`) drops that default import from generated files that never say `React.`.
- **The call screen** (`features/call/call-view.tsx`) follows the official `agent-session-view-01` block from LiveKit's agent starter (`livekit-examples/agent-starter-react`, cloned for reference into `.scratch/`, gitignored): agent visual in the middle, a transcript that opens over it, a status line and `AgentControlBar variant="livekit"` (mic with its device menu, transcript toggle, leave) at the bottom, `StartAudioButton` for blocked playback. We compose it from the block's parts instead of using the block, so the centre can be ours: `AgentAudioVisualizerAura` in highlighter (`color`, `themeMode`, `audioTrack={useAgent().microphoneTrack}`) with Dot Dot inside. The block and the grid, radial and wave visualizers were removed after.
- **Devices follow the system.** `AgentControlBar` remembers a chosen device in local storage unless `saveUserChoices={false}`; we pass false. livekit-client captures `deviceId: { ideal: "default" }` with `echoCancellation`, `noiseSuppression`, `autoGainControl` and `voiceIsolation` on by default (`audioDefaults` in livekit-client 2.23.0).
- **Levels.** `useTrackVolume(track)` (0 to 1) on `useAgent().microphoneTrack` (the agent's voice) and `useLocalParticipant().microphoneTrack.audioTrack` (the user's mic) drive the mascot.

## Agents UI, from the docs

- LiveKit's shadcn registry for agent frontends: `shadcn registry add @agents-ui`, then `shadcn add @agents-ui/<component>`; files land in `components/agents-ui/`.
- Its components import no primitive library themselves: they use our shadcn components through `registryDependencies` (`button`, `toggle`, `select`, `message`, `bubble`, `marker`, `message-scroller`), so they follow our base. Checked in the registry JSON at `https://livekit.io/ui/r/<name>.json`, 2026-11-03. Its own package.json lists Radix for its dev setup only. Needs `@livekit/components-react` and `livekit-client`.
- The official starter (`livekit-examples/agent-starter-react`) is Next.js with `style: new-york` and registries `@agents-ui` (`https://livekit.io/ui/r/{name}.json`) and `@ai-elements`.
- Docs: https://docs.livekit.io/frontends/agents-ui/, source: https://github.com/livekit/components-js/tree/main/packages/shadcn
