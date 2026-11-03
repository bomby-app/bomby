# Frontend notes

The app's web half (`app/src`). Checked against shadcn CLI 4.23.0, Tailwind CSS 4.3.4, Biome 2.6.4, `@base-ui/react` 1.9.0, `cn` 0.5.2, React 19 and Vite 8 (installed in `app/node_modules`), ui.shadcn.com docs (sources in `shadcn-ui/ui` `apps/v4/content/docs`), and docs.livekit.io, 2026-11-03.

## shadcn

- **Components are copied in, not installed.** `just app add <name>` runs the shadcn CLI, which writes the source to `src/components/ui/`. We treat it as generated: style it through props and `className` from our components. The recipe passes `--overwrite` (otherwise the CLI stops to ask about any file Biome reformatted), so `add` refreshes shared files like `separator.tsx` from the registry, and a hand edit there would be lost.
- **Base and style.** `components.json` has `style: base-nova`: Base UI primitives (`@base-ui/react`), the Nova look, neutral colors, lucide icons. Base UI is the CLI default (`--base base`); it also offers Radix and React Aria. See [decision](decisions/app-ui-on-shadcn-base-ui.md).
- **Changing base.** Set `style` in `components.json`, then `just app add` every component in `components/ui` to regenerate them. The CLI may not add the new primitive package when it only overwrites files; add it with `bun add`.
- **`cn` is a package now.** Generated components `import { cn } from "cn"` (published by shadcn; replaces `clsx` plus `tailwind-merge`). `src/lib/utils.ts` re-exports it for older registry code that imports `@/lib/utils`. Pinned to an exact version because 0.5.x is new.
- **Data variants.** shadcn's `data-active:` and friends (`shadcn/tailwind.css`) skip `data-active="false"`, so `isActive={false}` is safe.
- **`init` with `--no-pointer`** keeps the default arrow cursor on buttons, as native apps do.
- **Theme tokens** are CSS variables in `src/index.css` (`:root` light, `.dark` dark, mapped into Tailwind with `@theme inline`). Change colors there, not in components.
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

## Agents UI (next step)

- LiveKit's shadcn registry for agent frontends: `shadcn registry add @agents-ui`, then `shadcn add @agents-ui/<component>`; files land in `components/agents-ui/`.
- Its components import no primitive library themselves: they use our shadcn components through `registryDependencies` (`button`, `toggle`, `select`, `message`, `bubble`, `marker`, `message-scroller`), so they follow our base. Checked in the registry JSON at `https://livekit.io/ui/r/<name>.json`, 2026-11-03. Its own package.json lists Radix for its dev setup only. Needs `@livekit/components-react` and `livekit-client`.
- The official starter (`livekit-examples/agent-starter-react`) is Next.js with `style: new-york` and registries `@agents-ui` (`https://livekit.io/ui/r/{name}.json`) and `@ai-elements`.
- Docs: https://docs.livekit.io/frontends/agents-ui/, source: https://github.com/livekit/components-js/tree/main/packages/shadcn
