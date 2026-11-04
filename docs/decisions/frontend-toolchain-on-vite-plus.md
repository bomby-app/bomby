# Frontend toolchain on Vite+

Status: accepted, 2026-11-04. Replaces Biome from [app-ui-back-on-shadcn-radix.md](app-ui-back-on-shadcn-radix.md).

## Context

Biome formatted and linted the frontend, `tsc` checked types, Vite built it. Biome has none of React Compiler's rules, so effects that set state, refs read during render and mutations after render went unreported, and with React Compiler on, each one silently skips a component's optimization. The owner uses Vite+ (VoidZero) in other apps and asked for it here.

## Decision

- **Vite+** (`vite-plus`, project-local, no global CLI) for the whole frontend toolchain, configured in `app/vite.config.ts` only: Vite and Rolldown build, Oxlint lints, Oxfmt formats, and `vp check` runs format, lint and type checks (tsgolint) together.
- Oxlint runs the `react` plugin with its correctness category, which holds React Compiler's recommended rules, plus `jsx-a11y`, `typescript`, `unicorn` and `oxc`; `react/no-deriving-state-in-effects` is on too.
- **React Compiler** through Oxc's Rust port (`react({ compiler: true })`, `oxc-transform-react`), not Babel.
- Oxfmt keeps the earlier style (double quotes, no semicolons, ES5 trailing commas, width 80) and also sorts imports and Tailwind classes.

## Consequences

- One config file and one command (`just app check` calls `vp check`); the lint rules match what the compiler can optimize.
- `vite` resolves to `@voidzero-dev/vite-plus-core` through `overrides` in `app/package.json`; keep it at the installed `vite-plus` version, and `vitest` at its bundled version (`vp toolchain`).
- The Rust React Compiler integration is labelled experimental by `@vitejs/plugin-react`; Oxc reports output identical to the Babel plugin on 100k+ files.
- Biome and `biome.json` are gone.
