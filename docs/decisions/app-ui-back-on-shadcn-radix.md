# App UI back on shadcn with Radix

Status: accepted, 2026-11-04. Supersedes [app-ui-on-shadcn-base-ui.md](app-ui-on-shadcn-base-ui.md).

## Context

We moved to Base UI after checking that Agents UI imports no Radix itself. That was true, but its components are still written against Radix's behaviour. They style our `toggle` through Radix's `data-state="on"`/`"off"`, which Base UI never sets (it sets `data-pressed`). On the call screen that left the mic level bars without a colour (invisible), the muted mic without its red state and the transcript toggle without an open state, on top of two hand fixes for Base UI's Select and Toggle props. LiveKit's own starter uses Radix.

## Decision

- shadcn with the **Radix** base, `radix-nova` style (the same Nova look), the unified `radix-ui` package, Tailwind v4, lucide icons.
- Agents UI components are used as generated, with no hand fixes.
- The rest of the earlier records stands: Biome, the OS font and native defaults, the macOS overlay title bar.

## Why

- Agents UI and the agent starter are built and tested on Radix; matching them means their components work as shipped.
- One less thing to redo after every `just app add` of a LiveKit component.

## Consequences

- Composition is `asChild` again, and some props differ from Base UI (see [frontend-notes.md](../frontend-notes.md#radix)).
- Switched by setting `style` in `components.json` and regenerating every component; see [frontend-notes.md](../frontend-notes.md#shadcn).
