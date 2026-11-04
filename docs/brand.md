# Brand

The source of truth is the Paper file **bomby**, pages `branding` and `app assets`. This is the implementation summary. Read 2026-11-03; updated for Bomby on 2026-11-04.

## Name

- **Bomby**; lowercase wordmark `bomby`. Website `bomby.app` ([rename decision](decisions/name-bomby.md)).
- Tagline: **"Stop typing. Start talking."** (owner, 2026-11-04, from the cover). Supporting line: "Say the task out loud. Bomby hands it to your agent and tells you when it's done."
- Never co-brand with Claude, LiveKit or Gemini. Name them only to describe requirements or implementation. Their logos appear only in Settings and on the first-run card, in `currentColor`, except Claude's own colours on its first-run tile (owner's board, 2026-11-04).
- `.github/assets/cover.jpg` (1280 x 640) heads the README and serves as the social preview.

## Mark: Dot Dot

A speech bubble with a square bottom-left corner and two round eyes. It speaks and listens.

- Forms: **lockup** (default), **mark** (icons and small spaces), **wordmark** (when the mark is nearby).
- Clear space: half the bubble height. Minimum widths: lockup 100px, mark 16px with enlarged eyes, wordmark 14px.
- Never tilt, outline, sticker, stretch, flip the corner, add a mouth or features, or put highlighter on white.
- The 28px app tile is `app/src/components/app-logo.tsx`: ink/highlighter in light mode, reversed in dark.

## Colour

| Name | Hex | Role |
| --- | --- | --- |
| Highlighter | `#E8FF3A` | Primary; the one loud moment |
| Ink | `#121212` | Mark, text and main UI |
| Bubblegum | `#FF9BD2` | Claude and errors; fill only, with ink text |
| Paper | `#F4F4F1` | Quiet surfaces |
| White | `#FFFFFF` | Ground |

UI tokens (Paper board "07 Colour in UI"), light / dark:

| Variable | Light | Dark | Use |
| --- | --- | --- | --- |
| `--background` / `--card` | `#FFFFFF` | `#121212` / `#1A1A1A` | Window and panels |
| `--foreground` | `#121212` | `#F5F5F2` | Body text |
| `--muted` / `-foreground` | `#F4F4F1` / `#6B6B6B` | `#1F1F1F` / `#A3A3A3` | Quiet surfaces and secondary text |
| `--primary` / `-foreground` | `#121212` / `#E8FF3A` | `#E8FF3A` / `#121212` | Main action |
| `--accent` / `-foreground` | `#F4F4F1` / `#121212` | `#1F1F1F` / `#F5F5F2` | Hover, selected row, active project. Neutral grey, not the board's tinted highlighter, so hover stays quiet (owner, 2026-11-03) |
| `--border` / `--input` | `#E4E4E4` | `#2A2A2A` | Dividers and fields |
| `--ring` | `#121212` | `#E8FF3A` | Focus |
| `--sidebar` / `-primary` | `#F4F4F1` / `#121212` | `#161616` / `#E8FF3A` | Sidebar and logo tile |
| `--sidebar-accent` / `-foreground` | `#E8E8E4` / `#121212` | `#242424` / `#F5F5F2` | Sidebar hover and selection |
| `--claude` | `#FF9BD2` | `#FF9BD2` | Claude sessions and working indicators; fill only, ink text on it |
| `--destructive` | `#D92D20` | `#F97066` | End call and delete; never the mascot |
| `--highlighter` | `#E8FF3A` | `#E8FF3A` | Good news (a requirement ready, a task done): a disc with an ink icon, never a bare lime icon or text |

Owner's choices, 2026-11-04:

- Transcript bubbles (Paper board "In use / the conversation"): Bomby in highlighter with ink text, the user in ink with white text (raised grey in dark). Bubblegum stays for Claude's own messages when they show in the call.
- Resume buttons are bubblegum with ink text: resuming brings a conversation back.
- A small bubblegum **Beta** badge (ink text) follows the wordmark in the sidebar while the app is in beta.

Ready setup marks are an ink thumbs-up on highlighter. A missing item in Setup is a bubblegum button with ink text that goes to where it is added (Add key, Set up); the ink cross on bubblegum remains for a missing item without an action. Running tasks spin in `--primary`; failed tasks use `--destructive`.

Ink on highlighter (16.8:1) and bubblegum (9.7:1) is readable. Highlighter on white (1.1:1) and bubblegum on white (1.9:1) are never text or icons. Links use ink with a 3px highlighter underline; dark-mode links may use highlighter text.

## Type

- **Bricolage Grotesque Bold**: lowercase wordmark at -0.02em and display headlines.
- App interface: the OS font (owner, 2026-11-03). Web body: Bricolage Regular or Medium. Paper app previews use Inter only as a stand-in.

## Mascot states and motion

Only the eyes change, never the bubble shape or colours. States follow `useAgent()`:

- **Waking** (connecting, initializing): closed lines.
- **Idle**: blinks.
- **Listening**: wide eyes; bubble breathes with mic level.
- **Thinking**: eyes drift up-right.
- **Speaking**: glances every 1 to 2.5 s, blinks every 2 to 4 s with occasional double blinks, opens slightly on loud syllables; bubble pulses with voice. No squint: it should feel alive (owner, 2026-11-04).
- **Asleep** (disconnected): closed and greyed.
- **Failed**: crossed bubblegum eyes.
- **Working** and **done**, not wired yet: scanning eyes while a task runs; smiling arcs for 1.2 s when a result arrives.

`app/src/components/mascot.tsx` exports `<Mascot state level size />` and `mascotState(agentState)`. Dot Dot sits over LiveKit's bar visualizer on the call screen, replaces a project's folder icon during a call and appears on Start a call. Visualizer bars use `--primary`: highlighter in dark, ink in light (owner, 2026-11-04).

Motion uses CSS transforms on one SVG. Eyes lead; only sound scales the bubble. Use ease-out for changes, sine for loops, no bounce, and 120 to 400ms one-offs. Reduced motion removes loops and makes swaps instant, but keeps blinking. Below 32px nothing loops.

## First run

Paper page `splash`, option A (owner, 2026-11-04), in `app/src/features/onboarding/`. It shows until a call has everything it needs, and nothing gets past it before that: an agent that's set up, the LiveKit keys and the Gemini key (owner, 2026-11-05).

- **Glow.** `components/day-glow.tsx`: a glow rising from the bottom, by the Mac's clock: highlighter in the morning (5 to 12), option B's bubblegum glow around a highlighter core in the afternoon (12 to 17), bubblegum in option A's shape in the evening. Dark mode uses the dark boards. Its `rest` stage is the projects view's glow (page `projects view`), for reuse there.
- **Sequence.** One GSAP timeline, each move after the last, slow in and slow out (sine), as the owner asked (2026-11-05): the glow comes up from nothing while Dot Dot floats up from below with its eyes closed (3.2 s, slowing as it arrives); as it arrives its eyes open and it settles to full size, then it looks left, right and back at you; "Good morning, I'm bomby." and "Let's set up your first agent." fade in under it, stay 2.4 s and fade out; then Dot Dot moves up, small and listening, and the setup fades in with a slight rise. A new step fades the old one out first. About 11 s in all, with the six-second opening sound (`app/src/assets/splash-music.mp3`) at the start; reduced motion starts at the setup.
- **Film grain.** `components/film-grain.tsx`: moving grain over the glow, one tiny WebGL shader with no libraries, at 24 frames a second, blended with overlay at 9% (12% in dark); one still frame with reduced motion.
- **Mascot with depth.** `<Mascot depth />`: Paper's lit bubble (a gradient from above, a rim of light, catchlights in the eyes, a soft shadow), an ink bubble with highlighter eyes in light and the reverse in dark (`--mascot-*` tokens). Its closed eyes are the curved lids of the Done state; waking crossfades them into round eyes that open from a squint (560 ms), with the blink on its own layer. `look` turns the eyes left or right.
- **The agent step.** Claude Code when it's installed, ready or not, else Codex, else the first ready agent (owner, 2026-11-05), with Set up now (installs its adapter), the command it needs, or Ready; "Use … instead" picks another. Claude's tile keeps Claude's own colours, as the owner's board shows (`--agent-claude`).
- **Just one more step.** The LiveKit and Gemini keys on the same cards: Paste all reads LiveKit Cloud's Environment variables box from the clipboard, Paste key the Gemini key; "type them in" opens the Settings forms in a dialog. Steps already done are skipped.
- **Done.** With all three, the agent's card says "You're all set" and the round continue arrow appears, bottom right. It opens the projects home.

## Projects home

Paper page `projects view`, in `app/src/features/projects/projects-home.tsx`: the main panel with nothing selected. Dot Dot with depth, the day's greeting ("Good evening.") in the day glow's `rest` stage, then the recent projects (three, See all for the rest) or Create your first project. Call and Resume stay disabled, with a tooltip saying what's missing, until a call has an agent, LiveKit and Gemini (`features/call/use-call-readiness.ts`).

## Voice

Short, everyday sentences with contractions. Name the actor: Claude does the work, Bomby talks; say "Claude", not "Claude Code" (owner, 2026-11-04). When something breaks, state what happened and what to do, without leading error codes or exclamation marks. UI text uses sentence case.

| Moment | Say |
| --- | --- |
| No projects yet | Add a folder and start talking. |
| Connecting | Waking up... |
| Listening | Listening |
| Claude working | Claude's on it · fix-login |
| Claude done | Done. Claude changed 2 files. |
| Call failed | Lost the connection. Try again? |
| No mic access | Bomby needs your mic. Turn it on in System Settings. |
| Call ended | Talk soon. |

`agent/prompts/voice.md` applies this voice to the spoken agent, written as behaviour rather than adjectives because Gemini Live reads every word as an instruction (owner, 2026-11-04): one-or-two-sentence, outcome-first replies; even tone; no hype; humour only when the user jokes; silence while the user is quiet.

## App assets

Paper board `Handoff / Tauri asset map`, page `app assets`. Artboard names match their outputs:

- `app-icon.png` (1024 canvas, 824 tile): required `tauri icon` source for ICNS, ICO and PNGs.
- `Bomby.icon` (macOS 26+, `app/src-tauri/icons/`): light (ink bubble, highlighter eyes, on highlighter), dark (highlighter bubble, ink eyes, on ink) and tinted. Glossy, as the owner asked (2026-11-03): top-to-bottom gradients on tile, bubble and eyes, Liquid Glass with specular, a chromatic shadow under the bubble. Edit in Icon Composer and compile with `just app icon` ([details](tauri-notes.md#icons)).
- `app-icon-dark.png` (reference), `app-icon-flat.png` (optional ICO/Linux), `dmg-background.png` (660 x 400 at 1x and 2x, from the light `dmg-background` artboard; Finder's labels can't follow a dark one, see [Tauri notes](tauri-notes.md#dmg-window)), `tray-icon-template.png` (22 and 44).
- `app-logo-light` / `-dark` (28px SVG): `app-logo.tsx`.
