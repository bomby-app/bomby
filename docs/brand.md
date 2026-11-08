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
| `--highlighter` | `#E8FF3A` | `#E8FF3A` | Good news (a requirement ready, a task done): a disc with an ink icon, never a bare lime icon or text. A dialog's Save button, ink on it (`Button variant="highlighter"`, owner, 2026-11-05) |

Owner's choices, 2026-11-04:

- Transcript bubbles (Paper board "In use / the conversation"): Bomby in highlighter with ink text, the user in ink with white text (raised grey in dark). Bubblegum stays for Claude's own messages when they show in the call.
- Resume buttons are bubblegum with ink text: resuming brings a conversation back.
- A small bubblegum **Beta** badge (ink text) follows the wordmark in the sidebar while the app is in beta.

Ready setup marks are an ink thumbs-up on highlighter. A missing item in Setup is a bubblegum button with ink text that goes to where it is added (Add key, Set up); the ink cross on bubblegum remains for a missing item without an action. In the agents panel each task's status is one ink icon on a disc, its label a tooltip: bubblegum while it waits or joins a running task (queued, added), highlighter for working (spinning), done, failed and stopped (owner, 2026-11-05).

Ink on highlighter (16.8:1) and bubblegum (9.7:1) is readable. Highlighter on white (1.1:1) and bubblegum on white (1.9:1) are never text or icons. Links are full-contrast text (ink in light, white in dark) in medium weight, underlined only on hover, beside muted body text (owner, 2026-11-05).

## Type

- **Bricolage Grotesque Bold**: lowercase wordmark at -0.02em and display headlines.
- App interface: the OS font (owner, 2026-11-03). Web body: Bricolage Regular or Medium. Paper app previews use Inter only as a stand-in.

The Paper file's tokens carry the same names as `app/src/index.css` (dark values as `--color-dark-*`). Roles (Paper board "09 Type"), size / line height:

| Role | Size | Class | Use |
| --- | --- | --- | --- |
| Display | 40 / 44, Bricolage Bold, -0.03em | `text-display` | The projects home's greeting |
| Title | 34 / 38, Bricolage Bold, -0.03em | `text-title` | Splash step headings |
| Heading | 16 / 24 semibold (16 / 20 in cards) | `text-base` | Section and card headings |
| Lead | 15 / 22 | `text-lead` | The line under a display or title |
| Body | 14 / 20, regular or medium | `text-sm` | Everything else |
| Small | 12 / 16, mono | `font-mono text-xs` | Paths, counts |
| Label | 11 / 14, mono, uppercase, 0.08em | `font-mono text-label uppercase` | Section labels, the Beta badge |

The one exception is the 10px count in the agents panel's 16px disc. The splash keeps a few values off the scale until the owner approves snapping them (13 / 18 text, its 12px card buttons, the greeting's -0.035em).

## Spacing and radius

Paper board "10 Spacing and radius". Spacing goes in 4px steps: 4, 8, 12, 16, 20, 24, 28, 32, 40.

| Radius | px | Use |
| --- | --- | --- |
| `rounded-sm` | 6 | Sidebar items |
| `rounded-md` | 8 | Small buttons, tooltips, 32 and 36px tiles |
| `rounded-lg` | 10 | The base (`--radius`): buttons, inputs, select trigger, popovers, settings cards, project rows |
| `rounded-xl` | 14 | Dialogs, 56px splash tiles, splash and home buttons |
| `rounded-2xl` | 18 | Splash cards, the recent projects list |
| `rounded-full` | - | Discs, dots, badges, the continue arrow |

A nested corner is the outer radius minus the padding.

## Elevation

Paper board "11 Elevation". Three shadows, as `--elevation-*` in `:root` and `.dark` and used as `shadow-card`, `shadow-float` and `shadow-primary`:

- **Card**: the splash cards.
- **Float**: lists, popovers, select content. A 1px border ring plus a soft drop.
- **Primary**: the projects home's main button. Ink in light, a highlighter glow in dark.

Settings stays flat, with borders only.

## Mascot states and motion

Only the eyes change, never the bubble shape or colours. States follow `useAgent()`:

- **Waking** (connecting, initializing): closed lines.
- **Idle**: blinks.
- **Listening**: wide eyes; bubble breathes with mic level.
- **Thinking**: eyes drift up-right.
- **Speaking**: glances every 1 to 2.5 s, blinks every 2 to 4 s with occasional double blinks, opens slightly on loud syllables; bubble pulses with voice. No squint: it should feel alive (owner, 2026-11-04).
- **Asleep** (disconnected): closed and greyed.
- **Failed**: crossed eyes, bubblegum on the light theme's ink bubble and ink on the dark theme's highlighter bubble, where bubblegum would barely show (owner, 2026-11-05).
- **Done**: smiling arcs (Paper "04 Mascot states", Done) and a little hop, 6px up in 160ms, every 2.8 s while it shows. The update card uses it; the call's 1.2 s pulse when a result arrives isn't wired yet.
- **Working**, not wired yet: scanning eyes while a task runs.

The mascot speaks to the user on one card, `app/src/components/mascot-card.tsx`: its face, a headline, a line under it and one button. The error card is that card with the failed face; the update card in Settings, About is that card with the done face (Paper page "settings · about").

In the menu bar, the mascot swaps one template image per state and never animates (Motion board): no call (dots), waking, listening, thinking, speaking, working (eyes to the left, while an agent works and the voice only listens) and failed (crossed, for five seconds after a call fails). Paper `app assets`, `tray-icon-template` and `tray-icon-<state>-template`, exported at 36 px to `app/src-tauri/icons/tray/` ([Tauri notes](tauri-notes.md#menu-bar-icon)). Its menu: the call's project, Open Bomby, Start a call on the three recent projects (or what's missing), End call, Settings, Quit Bomby.

`app/src/components/mascot.tsx` exports `<Mascot state level size />` and `mascotState(agentState)`. Dot Dot sits over LiveKit's bar visualizer on the call screen, replaces a project's folder icon during a call and appears on Start a call. Visualizer bars use `--primary`: highlighter in dark, ink in light (owner, 2026-11-04).

Motion uses CSS transforms on one SVG. Eyes lead; only sound scales the bubble. Use ease-out for changes, sine for loops, no bounce, and 120 to 400ms one-offs. Reduced motion removes loops and makes swaps instant, but keeps blinking. Below 32px nothing loops.

## First run

Paper page `splash`, option A (owner, 2026-11-04), in `app/src/features/onboarding/`. A short form of two steps, the agent and then the keys; which one shows follows from what's set up and what the user chose. It shows until a call can talk: LiveKit (on this Mac, or the user's keys) and a voice provider with its key, with an agent that's set up or left for later (owner, 2026-11-06).

- **Glow.** `components/day-glow.tsx`: a glow rising from the bottom, by the Mac's clock: highlighter in the morning (5 to 12), option B's bubblegum glow around a highlighter core in the afternoon (12 to 17), bubblegum in option A's shape in the evening. Dark mode uses the dark boards. Its `rest` stage is the projects view's glow (page `projects view`), for reuse there.
- **Sequence.** One GSAP timeline, each move after the last, slow in and slow out (sine), as the owner asked (2026-11-05): the glow comes up from nothing while Dot Dot floats up from below with its eyes closed (3.2 s, slowing as it arrives); as it arrives its eyes open and it settles to full size, then it looks left, right and back at you; "Good morning, I'm bomby." and "Let's set up your first agent." fade in under it, stay 2.4 s and fade out; then Dot Dot moves up, small and listening, and the setup fades in with a slight rise. A new step fades the old one out first. About 11 s in all, with the six-second opening sound (`app/src/assets/splash-music.mp3`) at the start; reduced motion starts at the setup.
- **Film grain.** `components/film-grain.tsx`: moving grain over the glow, one tiny WebGL shader with no libraries, at 24 frames a second, blended with overlay at 9% (12% in dark); one still frame with reduced motion.
- **Mascot with depth.** `<Mascot depth />`: Paper's lit bubble (a gradient from above, a rim of light, catchlights in the eyes, a soft shadow), an ink bubble with highlighter eyes in light and the reverse in dark (`--mascot-*` tokens). Its closed eyes are the curved lids of the Done state; waking crossfades them into round eyes that open from a squint (560 ms), with the blink on its own layer. `look` turns the eyes left or right.
- **The agent step.** Claude Code when it's installed, ready or not, else Codex, else the first ready agent (owner, 2026-11-05), with Set up now (installs its adapter), its model, or what it needs. With none installed, Claude Code's card offers Install, which opens its own install page (Paper "04 Setup · No agent"). Installing and signing in stay the agent's own: the card only says whether it's ready, and under it "Already installed one? Check again" or "Set it up in Claude Code, then check again", then Set up later (owner, 2026-11-06). "Other supported agents" lists the rest, each to Use or Install. Claude's tile keeps Claude's own colours, as the owner's board shows (`--agent-claude`).
- **Just one more step.** Two labelled rows of two cards (Paper page `voice-provider-feature`, "05 Keys · Voice choice", "Rime picked · widens", "Rime saved · All set", 2026-11-06): Calls run on (LiveKit Local or Cloud) and Bomby talks through (Gemini or Rime). Local (white logo) is selected by default; choosing Cloud (blue logo) eases Local down to its tile and widens Cloud, whose Paste all reads LiveKit Cloud's Environment variables box from the clipboard. Gemini is picked at first, the default (owner, 2026-11-06); the other shows its model with a grey dot ("Prism"), and picking one eases the other down to its tile and widens it with Paste key, the same move as Cloud, and a saved key reads "Saved · Prism". Rime's tile carries a small highlighter circle with an E on its corner, "Experimental" on hover; Settings, Voice marks it with an Experimental badge in highlighter (owner, 2026-11-06). The paste buttons share one width. The footnote says where the keys still needed come from, or "Pick a voice. You can switch any time in Settings."; "type them in" opens one form with one Save. The step sits 32 px higher than the agent step, Bomby with it, to fit both rows. With every key in, the step says "You're all set" and the round arrow goes on. After Set up later it says "Let's still talk", with "Changed your mind? Set up an agent" under the footnote (Paper "05 Keys · After Set up later").
- **Going on.** Only the user moves the splash on (owner, 2026-11-06): a step that's done shows the round continue arrow, bottom right, and Return does the same. The agent step's arrow comes once its agent is ready and goes to the keys; Set up later goes there without one. With the keys in, the keys step says "You're all set" and its arrow opens the projects home.

## Projects home

Paper page `projects view`, in `app/src/features/projects/projects-home.tsx`: the main panel with nothing selected. Dot Dot with depth, the day's greeting ("Good evening.") in the day glow's `rest` stage, then the recent projects, the newest call first (three, See all for the rest), or Create your first project. The sidebar's logo brings it back, with no hover state. Each time it opens, Dot Dot drops in and settles like something with weight, a damped spring (`elastic.out(1, 0.45)`, 1.6 s): the one place it overshoots, by the owner's choice (2026-11-05). Call and Resume stay disabled, with a tooltip saying what's missing, until a call has LiveKit and a voice provider with its key (`features/call/use-call-readiness.ts`); a call with no agent ready still talks.

## Workspace panel

The panels on the right of a project (`app/src/features/workspace/`) sit on the window's background in a column with a 1px border at its edge. In the project's header, each panel's toggle is a quiet icon (Changes, Files, Terminal, To-dos), with its count in mono and the accent grey while open, between the page's own actions and its main action, which stands alone at the right end (owner, 2026-11-08). Each panel has a titlebar-height header: its name in 14 px medium, its count in mono, its own actions, then expand and close; Terminal's terminals are quiet text tabs there when there are several, the chosen one on the accent grey; keyboard focus is the same grey, never a ring (WebKit shows focus after typing in a terminal as keyboard focus, so a ring lit up on clicks). Open panels are divided by 1 px handles. Diffs use Pierre's light and dark themes on our background, with the system's monospaced font at 12 px. Terminals use the same font on the background, with their own 16 ANSI colours (`--terminal-ansi-*` in `index.css`): on ink, highlighter is the yellow and the cursor, bubblegum the magenta; on white, an amber stands in for yellow and the cursor is ink, so highlighter never sits on white. A file's git status is one mono letter (M, U, A, R, D) in the change colours (`--change-added`, `--change-modified`, `--change-deleted`): the same in the diff's file headers, their +/− counts and lines, and the file tree, where a folder with changes inside gets a dot. On ink, modified is highlighter; on white, it's the amber. An image previews fitted to the panel with its pixel size and file size under it in mono. The To-dos panel (Paper page `extensions`): search and a status filter (Open, the default, then All and each status, with counts in mono), an "Add a to-do" field on the muted grey, then the to-dos under mono labels by status (Doing, To do; Done folded under a "2 done · Show" row). A to-do's status is one 16 px mark: an empty circle to do, a half-filled ink circle doing, a highlighter disc with an ink tick done, a slashed grey circle cancelled (its words struck through); clicking the mark picks another. Its number sits on the right in mono, the one Bomby says. A line under it says when Bomby changed it last ("Bomby added it · just now"), with nothing for the user's own changes. Clicking its words edits it in place, ink-ringed, with notes, Delete and the highlighter Save. With none: the mascot, "Nothing to do yet." and "Add one above, or just tell Bomby on a call." Its toggle is the list icon with the open count; Settings, Extensions is one card of switches, kept to each extension's name and a line (owner, 2026-11-08). Diff file headers are ours: a chevron that folds the file, the letter, the name with its folder muted in mono, and the counts. Not yet drawn in Paper.

## Voice

Short, everyday sentences with contractions. Name the actor: Claude does the work, Bomby talks; say "Claude", not "Claude Code" (owner, 2026-11-04). When something breaks, state what happened and what to do, without leading error codes or exclamation marks. On screen that's the error card: the failed mascot, what happened as its headline and what to do under it (`app/src/components/error-card.tsx`). UI text uses sentence case.

| Moment | Say |
| --- | --- |
| No projects yet | Add a folder and start talking. |
| Connecting | Waking up... |
| Listening | Listening |
| Claude working | Claude's on it · fix-login |
| Claude done | Done. Claude changed 2 files. |
| Notification, task done / failed | Claude's done · fix-login / Claude couldn't finish · fix-login |
| Call failed | Lost the connection. Try again? |
| Agent couldn't start | Bomby couldn't start the call. Try again? |
| Memory unreachable on a call | I have no memory! / I can't reach it right now. The call works as usual. (the owner's words, 2026-11-06) |
| A project's folder is gone | The folder samba isn't there any more. Add it again in Project settings. |
| No mic access | Bomby needs your mic. Turn it on in System Settings. |
| Call ended | Talk soon. |
| Update ready | Version 0.2.0 is ready. / Restart Bomby to update. It takes a few seconds. [Restart to update] |
| Update on its way | Getting version 0.2.0... / 42% · Bomby restarts when it's done. |
| Update waiting for a call to end | Version 0.2.0 is downloaded. / Restart Bomby to finish, once your call is over. [Restart to update] |

`agent/prompts/sharp.md` (and its tone variants, `chatty.md` and `playful.md`) applies this voice to the spoken agent, written as behaviour rather than adjectives because Gemini Live reads every word as an instruction (owner, 2026-11-04): one-or-two-sentence, outcome-first replies; even tone; no hype; humour only when the user jokes; silence while the user is quiet.

## App assets

Paper board `Handoff / Tauri asset map`, page `app assets`. Artboard names match their outputs:

- `app-icon.png` (1024 canvas, 824 tile): required `tauri icon` source for ICNS, ICO and PNGs.
- `Bomby.icon` (macOS 26+, `app/src-tauri/icons/`): light (ink bubble, highlighter eyes, on highlighter), dark (highlighter bubble, ink eyes, on ink) and tinted. Glossy, as the owner asked (2026-11-03): top-to-bottom gradients on tile, bubble and eyes, Liquid Glass with specular, a chromatic shadow under the bubble. Edit in Icon Composer and compile with `just app icon` ([details](tauri-notes.md#icons)).
- `app-icon-dark.png` (reference), `app-icon-flat.png` (optional ICO/Linux), `dmg-background.png` (660 x 400 at 1x and 2x, from the light `dmg-background` artboard; Finder's labels can't follow a dark one, see [Tauri notes](tauri-notes.md#dmg-window)), `tray-icon-template` and one `tray-icon-<state>-template` per mascot state (22 px artboards, transparent: macOS needs the alpha for a template), exported at 36 px to `app/src-tauri/icons/tray/<state>.png`.
- `app-logo-light` / `-dark` (28px SVG): `app-logo.tsx`.
