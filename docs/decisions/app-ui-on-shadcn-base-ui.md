# App UI on shadcn with Base UI

Status: accepted, 2026-11-03. Supersedes [app-ui-on-shadcn-radix.md](app-ui-on-shadcn-radix.md).

## Context

The app uses shadcn components. shadcn's CLI now defaults to Base UI (`base-nova`); Radix is the older option. We first chose Radix, believing LiveKit's Agents UI needs it. Checking its registry items (2026-11-03) showed it doesn't: no Agents UI component imports Radix or uses `asChild`. They build on the project's own shadcn `button`, `toggle`, `select`, `message` and so on, whichever base those are.

## Decision

- shadcn with the **Base UI** base, `base-nova` style, Tailwind v4, lucide icons.
- The rest of the earlier record stands: Biome, the OS font and native defaults, the macOS overlay title bar.

## Why

- Base UI is shadcn's default and actively maintained; the owner uses it across projects (STA-bot) and finds the code cleaner.
- One primitive library for our components and for Agents UI, since Agents UI renders through our components.

## Consequences

- Base UI composes with a `render` prop where Radix used `asChild`, and some props differ (see [frontend-notes.md](../frontend-notes.md#base-ui)).
- When an Agents UI component lands, check that it works with the Base UI `select` and `toggle` it pulls in.
