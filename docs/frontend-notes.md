# Frontend notes

The app's web half (`app/src`). Checked against shadcn CLI 4.23.0, Tailwind CSS 4.3.4, Biome 2.6.4, `radix-ui` 1.8.1, `cn` 0.5.2, React 19 and Vite 8 (installed in `app/node_modules`), ui.shadcn.com docs (sources in `shadcn-ui/ui` `apps/v4/content/docs`), and docs.livekit.io, 2026-11-03; moved to Radix 2026-11-04.

## shadcn

- **Components are copied in, not installed.** `just app add <name>` runs the shadcn CLI, which writes the source to `src/components/ui/`. We treat it as generated: style it through props and `className` from our components. The recipe passes `--overwrite`, so `add` refreshes shared files like `separator.tsx` from the registry, and a hand edit there would be lost.
- **Base and style.** `components.json` has `style: radix-nova`: Radix primitives (the unified `radix-ui` package), the Nova look, neutral colors, lucide icons. The CLI's default base is Base UI (`--base base`); it also offers Radix (`--base radix`) and React Aria. See [decision](decisions/app-ui-back-on-shadcn-radix.md).
- **Changing base.** Set `style` in `components.json`, then `just app add` every component in `components/ui` and `components/agents-ui` to regenerate them. The CLI did not add the new primitive package when it only overwrote files (4.23.0, Base UI to Radix): add it with `bun add`, and remove the old one. `shadcn apply` and `init --base` would also rewrite the theme in `index.css`; `shadcn migrate radix` only moves `@radix-ui/react-*` imports to `radix-ui`.
- **`cn` is a package now.** Generated components `import { cn } from "cn"` (published by shadcn; replaces `clsx` plus `tailwind-merge`). `src/lib/utils.ts` re-exports it for older registry code that imports `@/lib/utils`. Pinned to an exact version because 0.5.x is new.
- **Data variants.** shadcn's `data-active:` and friends (`shadcn/tailwind.css`) skip `data-active="false"`, so `isActive={false}` is safe.
- **`init` with `--no-pointer`** keeps the default arrow cursor on buttons, as native apps do.
- **Theme tokens** are CSS variables in `src/index.css` (`:root` light, `.dark` dark, mapped into Tailwind with `@theme inline`), set to the Bomby palette from [brand.md](brand.md). We added `--claude` / `--claude-foreground` (`bg-claude text-claude-foreground`) for anything that means Claude. Change colours there, not in components.
- **Fonts.** UI text is the OS font (`font-sans`). `font-heading` is Bricolage Grotesque, Bold only (`@fontsource/bricolage-grotesque/700.css`, bundled, no network): the wordmark (`components/wordmark.tsx`) and headlines. shadcn's Empty and Sheet titles use `font-heading`, so they get it too.
- **Sidebar** (`ui/sidebar.tsx`): `SidebarProvider` > `Sidebar` (`variant` sidebar, floating or inset; `collapsible` offcanvas, icon or none) + `SidebarInset`. Cmd+B toggles it. Below 768px it turns into a sheet; the window's `minWidth` (820) keeps us above that. Its open-state cookie is for server rendering and does nothing here.
- **Dark mode on Vite** is a provider that toggles `.dark` on `<html>` (shadcn docs, `dark-mode/vite`). Ours also follows OS changes while on "system" and sets the native window theme; see [tauri-notes.md](tauri-notes.md#window).

## Radix

- Composition uses `asChild`: `<TooltipTrigger asChild><Button variant="ghost">...</Button></TooltipTrigger>`. Triggers nest the same way (a tooltip on an alert dialog's trigger button).
- `TooltipProvider` takes `delayDuration` (ms).
- `ToggleGroup type="single"` has a string `value`; pressing the selected item again gives `""`.
- `Select` `value` is a string or `undefined` (never null); `SelectContent position="popper"` drops it below the trigger instead of over the chosen item.
- State attributes are `data-state` (`open`/`closed`, `on`/`off`), which Agents UI's toggles and the sidebar's collapsible rows style against.
- `Kbd` inside `TooltipContent` is styled by the tooltip itself (`**:data-[slot=kbd]`); group keys with `KbdGroup` (shadcn docs, `components/base/kbd`, example `kbd-tooltip`).

## Tailwind v4

- Configured in CSS, no `tailwind.config.js`: `@import "tailwindcss"` plus the `@tailwindcss/vite` plugin.
- `--spacing-<name>` in `@theme` makes size utilities: `--spacing-titlebar` gives `h-titlebar`.
- `@custom-variant` adds variants: `dark` (shadcn) and our `macos`, keyed on `data-platform` set in `index.html`.

## Biome

- One tool for format, lint and import order (`biome.json`, `just app lint` / `just app fmt`), set to match shadcn's style (double quotes, no semicolons, ES5 trailing commas, 80 columns).
- **Vendor code is kept as installed.** Biome skips `src/components/ui`, `src/components/agents-ui`, `src/hooks/agents-ui` and `src/hooks/use-mobile.ts` entirely (`files.includes` with `!!`): no lint, no format, nothing changed after `just app add`.
- `tsconfig.json` keeps `noUnusedLocals` and `noUnusedParameters`, which vendor code also passes as installed (2026-11-04). The Aura visualizer did not (an unused `import React`); if another registry file fails them, move the unused-code check to Biome (`noUnusedImports`, `noUnusedVariables`) rather than editing the file.
- Tailwind class sorting (`useTailwindSortedClasses`) is a nursery rule in 2.6, so it's off.

## Agents UI

- Installed with `just app add @agents-ui/<name>`: `agent-session-provider`, `agent-control-bar`, `agent-chat-transcript`, `agent-audio-visualizer-bar` and what they pull in. Files land in `src/components/agents-ui/` and `src/hooks/agents-ui/`; like `components/ui`, they are vendor code, kept as installed.
- **The call screen** (`features/call/call-view.tsx`) follows the official `agent-session-view-01` block from LiveKit's agent starter (`livekit-examples/agent-starter-react`, cloned for reference into `.scratch/`, gitignored): agent visual in the middle, a transcript that opens over it, a status line and `AgentControlBar variant="livekit"` (mic with its device menu, transcript toggle, leave) at the bottom, `StartAudioButton` for blocked playback. We compose it from the block's parts instead of using the block, so the centre can be ours: Dot Dot over `AgentAudioVisualizerBar` (5 bars, `size` `sm`, `icon` while the transcript is open; `audioTrack={agent.microphoneTrack}`; coloured with `className="text-primary"`, since the bars draw in `currentColor`). While the transcript is open a fade from solid background sits behind the agent at the top, so bubbles scroll under it. The Aura visualizer was removed at the owner's request (2026-11-04).
- **Devices follow the system.** `AgentControlBar` remembers a chosen device in local storage unless `saveUserChoices={false}`; we pass false. livekit-client captures `deviceId: { ideal: "default" }` with `echoCancellation`, `noiseSuppression`, `autoGainControl` and `voiceIsolation` on by default (`audioDefaults` in livekit-client 2.23.0).
- **Levels.** `useTrackVolume(track)` (0 to 1) on `useAgent().microphoneTrack` (the agent's voice) and `useLocalParticipant().microphoneTrack.audioTrack` (the user's mic) drive the mascot.

## Agents UI, from the docs

- LiveKit's shadcn registry for agent frontends: `shadcn registry add @agents-ui`, then `shadcn add @agents-ui/<component>`; files land in `components/agents-ui/`.
- Its components import no primitive library themselves: they use our shadcn components through `registryDependencies` (`button`, `toggle`, `select`, `message`, `bubble`, `marker`, `message-scroller`), so they follow our base. Checked in the registry JSON at `https://livekit.io/ui/r/<name>.json`, 2026-11-03. Its own package.json lists Radix for its dev setup only. Needs `@livekit/components-react` and `livekit-client`.
- The official starter (`livekit-examples/agent-starter-react`) is Next.js with `style: new-york` and registries `@agents-ui` (`https://livekit.io/ui/r/{name}.json`) and `@ai-elements`.
- Docs: https://docs.livekit.io/frontends/agents-ui/, source: https://github.com/livekit/components-js/tree/main/packages/shadcn
