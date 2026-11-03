# App UI on shadcn with Radix

Status: superseded by [app-ui-on-shadcn-base-ui.md](app-ui-on-shadcn-base-ui.md), 2026-11-03. Its main reason was wrong: Agents UI components don't import Radix.

## Context

The desktop app needs a clean, native-feeling UI with light, dark and system themes, a good sidebar, and LiveKit's Agents UI components for the call. The owner uses shadcn on the web. shadcn now offers three primitive libraries: Base UI (the CLI default), Radix and React Aria.

## Decision

- shadcn components with the **Radix** base (`radix-nova` style), Tailwind v4, lucide icons.
- **Biome** for formatting, linting and import order, configured to match shadcn's output.
- The **OS font** (`system-ui`) instead of a web font, and native defaults: no text selection on chrome, arrow cursor, no page scroll, tooltips after a delay.
- A macOS **overlay title bar**: the sidebar runs to the top of the window and the traffic lights sit in it.

## Why

- Agents UI is built on Radix. Using Base UI for our components would ship two primitive libraries and two styles of the same widgets.
- shadcn gives us the source, so the look stays ours to tune, and its sidebar covers collapse, keyboard toggle and theming.
- Biome is one fast tool where ESLint plus Prettier is two, with fewer configs to keep.
- The system font and native defaults are most of what makes a webview app feel native.

## Consequences

- `src/components/ui/` is generated code; we style it from outside and lint only our own code.
- Tailwind class order is not enforced until Biome's rule leaves the nursery.
- The overlay title bar is macOS only; Windows and Linux keep the native title bar, and the layout hides the macOS spacer there.
