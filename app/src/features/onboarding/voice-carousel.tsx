import { ChevronLeft, ChevronRight } from "lucide-react"
import {
  AnimatePresence,
  MotionConfig,
  motion,
  type Transition,
  useIsPresent,
  type Variants,
} from "motion/react"
import { type KeyboardEvent, type ReactNode, useState } from "react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  chooseVoiceProvider,
  type Keys,
} from "@/features/call-server/use-saved-keys"
import type { VoiceProvider } from "@/features/voice/api"
import { PROVIDER_ORDER, PROVIDERS } from "@/features/voice/providers"
import { cn } from "@/lib/utils"

import { PasteButton, SetupCard, StatusLine, Tile } from "./setup-card"

// The carousel's move: the card on show slides out the way it's going while the next one
// slides in behind it, both easing their opacity, on one soft spring (no bounce), so nothing
// pops. Reduced motion keeps only the fade.
const SLIDE = 40
const SPRING: Transition = { type: "spring", duration: 0.5, bounce: 0 }
const SLIDES: Variants = {
  enter: (dir: number) => ({ x: dir * SLIDE, opacity: 0, filter: "blur(3px)" }),
  shown: { x: 0, opacity: 1, filter: "blur(0px)" },
  exit: (dir: number) => ({ x: -dir * SLIDE, opacity: 0, filter: "blur(3px)" }),
}

/**
 * Who Bomby talks through, one provider's card at a time in the order Settings lists them
 * (Paper, voice-provider-feature: Option 4c, bare chevrons). The card on show is the pick:
 * the chevrons, the dots and the arrow keys pick the next one round. The pick shows at once
 * everywhere on the page while the core saves it (`chooseVoiceProvider`).
 */
export function VoiceCarousel({
  keys,
  paste,
  pasting,
}: {
  keys: Keys
  paste: (form: FormData) => void
  pasting: boolean
}) {
  // Which way the last move went, so the cards slide that way.
  const [dir, setDir] = useState<1 | -1>(1)
  const shown = keys.voice ?? PROVIDER_ORDER[0]
  const at = PROVIDER_ORDER.indexOf(shown)
  const count = PROVIDER_ORDER.length

  function go(to: VoiceProvider, towards: 1 | -1) {
    if (to === shown) return
    setDir(towards)
    void chooseVoiceProvider(to)
  }
  const step = (towards: 1 | -1) =>
    go(PROVIDER_ORDER[(at + towards + count) % count], towards)
  // The arrow keys step round from the dots and the chevrons.
  const arrows = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") step(-1)
    else if (event.key === "ArrowRight") step(1)
    else return
    event.preventDefault()
  }

  return (
    <fieldset
      aria-roledescription="carousel"
      aria-label="Bomby talks through"
      className="flex min-w-0 flex-col gap-2"
    >
      <div className="flex items-center justify-between pr-1">
        <span className="pl-1 font-mono text-label text-muted-foreground uppercase">
          Bomby talks through
        </span>
        <div className="flex items-center gap-[5px]">
          {PROVIDER_ORDER.map((provider, index) => (
            <button
              key={provider}
              type="button"
              aria-label={`Talk through ${PROVIDERS[provider].name}`}
              aria-current={provider === shown}
              onClick={() => go(provider, index > at ? 1 : -1)}
              onKeyDown={arrows}
              className={cn(
                "h-1.5 rounded-full transition-[width,background-color] duration-500 ease-in-out outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
                provider === shown
                  ? "w-4 bg-primary"
                  : "w-1.5 bg-foreground/25 hover:bg-foreground/50"
              )}
            />
          ))}
        </div>
      </div>
      <div className="relative h-[90px] w-[440px]">
        <MotionConfig reducedMotion="user">
          <AnimatePresence initial={false} custom={dir}>
            <Slide key={shown} dir={dir}>
              <VoiceCard
                provider={shown}
                keys={keys}
                paste={paste}
                pasting={pasting}
              />
            </Slide>
          </AnimatePresence>
        </MotionConfig>
        <Chevron side="previous" onClick={() => step(-1)} onKeyDown={arrows} />
        <Chevron side="next" onClick={() => step(1)} onKeyDown={arrows} />
      </div>
    </fieldset>
  )
}

/**
 * One card's slide. A card on its way out still shows for its exit, but is inert, so its
 * Paste key can't be reached and save a key for the provider just left.
 */
function Slide({ dir, children }: { dir: 1 | -1; children: ReactNode }) {
  const present = useIsPresent()
  return (
    <motion.div
      custom={dir}
      variants={SLIDES}
      initial="enter"
      animate="shown"
      exit="exit"
      transition={SPRING}
      inert={!present}
      className="absolute inset-0"
    >
      {children}
    </motion.div>
  )
}

/** A provider's card: its model until its key is saved, then Saved, with Paste key until then. */
function VoiceCard({
  provider,
  keys,
  paste,
  pasting,
}: {
  provider: VoiceProvider
  keys: Keys
  paste: (form: FormData) => void
  pasting: boolean
}) {
  const copy = PROVIDERS[provider]
  const Logo = copy.logo
  const saved = keys.voiceKeys[provider]
  return (
    <SetupCard
      tile={
        <Tile className="relative">
          <Logo className={copy.tileClassName} />
          {copy.experimental && <ExperimentalMark />}
        </Tile>
      }
      name={copy.name}
      status={
        saved ? (
          <StatusLine tone="done" text={`Saved · ${copy.model}`} />
        ) : (
          <StatusLine tone="off" text={copy.model} />
        )
      }
      action={
        <AnimatePresence initial={false}>
          {!saved && (
            <motion.div
              key="action"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
            >
              <form action={paste}>
                <input type="hidden" name="provider" value={provider} />
                <PasteButton disabled={pasting}>Paste key</PasteButton>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      }
    />
  )
}

/** A bare chevron beside the card, half bright until hovered, then highlighter. */
function Chevron({
  side,
  onClick,
  onKeyDown,
}: {
  side: "previous" | "next"
  onClick: () => void
  onKeyDown: (event: KeyboardEvent) => void
}) {
  const Icon = side === "previous" ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      aria-label={side === "previous" ? "Previous voice" : "Next voice"}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={cn(
        "absolute top-[29px] flex size-8 items-center justify-center rounded-full text-foreground/50 transition-colors duration-200 outline-none hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50",
        side === "previous" ? "-left-11" : "-right-11"
      )}
    >
      <Icon className="size-[22px]" strokeWidth={2.2} />
    </button>
  )
}

/** An E on the tile's corner, Experimental on hover. */
function ExperimentalMark() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="absolute -top-1 -right-1 z-10 flex size-4 items-center justify-center rounded-full bg-highlighter text-[10px] leading-none font-bold text-highlighter-foreground">
          E
        </span>
      </TooltipTrigger>
      <TooltipContent>Experimental</TooltipContent>
    </Tooltip>
  )
}
