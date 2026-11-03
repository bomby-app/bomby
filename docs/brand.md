# Brand

The source of truth is the Paper file **claudible** (pages `branding` and `app assets`). This page is the short version for building the app. Read 2026-11-03.

## Name

- Claudible. Wordmark lowercase `claudible`; in sentences "Claudible". Website `claudible.app`.
- Tagline: "A voice agent that runs Claude Code. Built on LiveKit."
- Never co-brand with Claude or LiveKit ("Claude x LiveKit", "Claude LiveKit"). See [name-claudible.md](decisions/name-claudible.md).

## Mark: Dot Dot

- A speech bubble with one square corner (bottom left) and two round eyes. It speaks and listens.
- Three forms: **lockup** (mark + wordmark, default), **mark** alone (icons, avatars, small spaces), **wordmark** alone (when the mark is nearby).
- Clear space: half the bubble's height on every side. Minimum sizes: lockup 100px wide, mark 16px (eyes enlarged), wordmark 14px.
- Don't tilt, outline, sticker, stretch, flip the corner, add a mouth or features, or put highlighter on white.
- The app's 28px tile is `app/src/components/app-logo.tsx`: ink tile with highlighter bubble in light mode, highlighter tile with ink bubble in dark (artboards `app-logo-light`, `app-logo-dark`).

## Colour

| Name | Hex | Role |
| --- | --- | --- |
| Highlighter | `#E8FF3A` | Primary. The one loud moment. |
| Ink | `#121212` | Mark, text, the UI's main colour. |
| Bubblegum | `#FF9BD2` | Accent. Means Claude, and errors. Fill only, ink text on it. |
| Paper | `#F4F4F1` | Quiet surfaces. |
| White | `#FFFFFF` | Ground. |

UI mapping onto the shadcn variables (board "07 Colour in UI"), light / dark:

| Variable | Light | Dark | Use |
| --- | --- | --- | --- |
| `--background` / `--card` | `#FFFFFF` | `#121212` / `#1A1A1A` | Window and panels |
| `--foreground` | `#121212` | `#F5F5F2` | Body text |
| `--muted` / `-foreground` | `#F4F4F1` / `#6B6B6B` | `#1F1F1F` / `#A3A3A3` | Quiet surfaces, secondary text |
| `--primary` / `-foreground` | `#121212` / `#E8FF3A` | `#E8FF3A` / `#121212` | Main action: ink with highlighter text, flipped in dark |
| `--accent` / `-foreground` | `#F4F4F1` / `#121212` | `#1F1F1F` / `#F5F5F2` | Hover, selected row, active project. Owner's change, 2026-11-03: neutral grey, not the board's tinted highlighter, so hover stays quiet. |
| `--border` / `--input` | `#E4E4E4` | `#2A2A2A` | Dividers, fields |
| `--ring` | `#121212` | `#E8FF3A` | Focus rings |
| `--sidebar` / `-primary` | `#F4F4F1` / `#121212` | `#161616` / `#E8FF3A` | Sidebar and its logo tile |
| `--sidebar-accent` / `-foreground` | `#E8E8E4` / `#121212` | `#242424` / `#F5F5F2` | Sidebar row hover and selection: a lighter (or darker) grey than the sidebar, as in other desktop apps |
| `--claude` (new) | `#FF9BD2` | `#FF9BD2` | Claude sessions, working indicators. Fill only, ink text on it |
| `--destructive` | `#D92D20` | `#F97066` | End call, delete. Not for the mascot |

Contrast: ink on highlighter 16.8:1 and ink on bubblegum 9.7:1 are always fine. Highlighter on white (1.1:1) and bubblegum on white (1.9:1) are never text or icons. Links are ink text with a 3px highlighter underline; in dark mode highlighter text is fine.

## Type

- **Bricolage Grotesque Bold**: the wordmark (lowercase, -0.02em) and display headlines.
- Interface text: the OS font in the app (owner confirmed 2026-11-03; the Paper app previews use Inter as its stand-in). Bricolage Regular and Medium are for body text on the web.

## Mascot states and motion

- Only the eyes change: never the bubble shape or its colours. States follow LiveKit's agent state (`useAgent()`): waking (connecting, initializing: closed lines), idle (blinks), listening (eyes wide, bubble breathes with mic level), thinking (eyes drift up-right), speaking (oval eyes, bubble pulses with the voice), asleep (disconnected: closed, greyed), failed (crossed bubblegum eyes). Ours on top: working (a Claude session runs: eyes scan left and right, a layer over any live state) and done (smiling arcs for 1.2s when a result arrives).
- Motion: eyes lead, the bubble only scales with sound; driven by audio level, not timers; ease-out for changes, sine for loops, no bounce, 120 to 400ms one-offs. One SVG component: `<Mascot state working done level />`, CSS transforms only. Reduced motion: no loops, instant swaps, blink stays. Under 32px nothing loops.

## Voice

- Say it out loud: short sentences, everyday words, contractions.
- Name who's acting: Claude does the work, Claudible talks. "Claude's on it", not "Task running".
- Calm when it breaks: what happened, then what to do. No codes up front, no exclamation marks.
- UI text in sentence case.

| Moment | Say |
| --- | --- |
| No projects yet | Add a folder and start talking. |
| Connecting | Waking up... |
| Listening | Listening |
| Claude working | Claude's on it · fix-login |
| Claude done | Done. Claude changed 2 files. |
| Call failed | Lost the connection. Try again? |
| No mic access | Claudible needs your mic. Turn it on in System Settings. |
| Call ended | Talk soon. |

## App assets

Board "Handoff / Tauri asset map" on the `app assets` page. Each artboard is named after the file it exports to:

- `app-icon.png` (1024, 824 tile): the `tauri icon` source for icon.icns, icon.ico and all PNGs. Required.
- `Claudible.icon`: built in Icon Composer from `icon-composer-1-bubble.svg` and `icon-composer-2-eyes.svg` for macOS 26 light, dark, clear and tinted; Tauri compiles it to Assets.car. Needs `actool` from Xcode 26, which this Mac doesn't have (Command Line Tools only), so it waits.
- `app-icon-dark.png` (reference), `app-icon-flat.png` (optional, ico and Linux), `dmg-background.png` (660 x 400, optional), `tray-icon-template.png` (22 and 44, with the tray).
- `app-logo-light` / `-dark` (28px SVG): `app-logo.tsx`.
