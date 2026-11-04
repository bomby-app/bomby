import { ArrowRight } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useEffect, useEffectEvent, useState, useTransition } from "react"

import music from "@/assets/splash-music.mp3"
import { DayGlow, type Daypart, useDaypart } from "@/components/day-glow"
import { FilmGrain } from "@/components/film-grain"
import { Mascot, type MascotState } from "@/components/mascot"
import { isReady, useAgents } from "@/features/agents/use-agents"
import { useSavedKeys } from "@/features/credentials/use-saved-keys"

import { finishFirstRun } from "./api"
import { FirstAgent, firstAgent } from "./first-agent"
import { KeysStep } from "./keys-step"

/**
 * The first run (Paper "splash", option A): the day's glow rises like a sunrise, Bomby wakes
 * and says hello, then sets up the first agent and, one more step, the LiveKit and Gemini
 * keys. Steps already done are skipped. The round arrow to go on comes only once a call
 * has all three, and there is no way around it: the app can't work without them.
 */
type Stage = "night" | "dawn" | "rise" | "awake" | "setup"

// When each stage starts (ms) and how long its glow and mascot take to get there: slow,
// overlapping moves across the six seconds of the opening sound.
const TIMELINE: [Stage, number][] = [
  ["dawn", 80],
  ["rise", 1500],
  ["awake", 3000],
  ["setup", 5400],
]
const TAKES: Record<Stage, number> = {
  night: 0,
  dawn: 1.4,
  rise: 1.6,
  awake: 1.8,
  setup: 2.2,
}

const GREETING: Record<Daypart, string> = {
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
}

const MASCOT: Record<Stage, { size: number; state: MascotState }> = {
  night: { size: 112, state: "waking" },
  dawn: { size: 112, state: "waking" },
  rise: { size: 112, state: "waking" },
  awake: { size: 120, state: "idle" },
  setup: { size: 60, state: "listening" },
}

// Slow in and slow out (sine), like the glow (day-glow.css).
const EASE = [0.37, 0, 0.63, 1] as const

export function Splash({ onDone }: { onDone: () => void }) {
  const still = useReducedMotion() === true
  const daypart = useDaypart()
  const [stage, setStage] = useState<Stage>(still ? "setup" : "night")
  const [leaving, startLeaving] = useTransition()
  // Out of sight, then peeking up at dawn (Paper: 240 px down in a 520 px window).
  const [below] = useState(() => window.innerHeight / 2)
  const { agents } = useAgents()
  const [chosen, setChosen] = useState<string | null>(null)
  const agent = firstAgent(agents, chosen)
  const { keys } = useSavedKeys()
  const agentReady = agent !== null && isReady(agent)
  const keysReady = keys !== null && keys.livekit && keys.gemini
  const ready = agentReady && keysReady
  // The keys come once the agent is ready; with both, the agent's card says all is set.
  const step = agentReady && keys !== null && !keysReady ? "keys" : "agent"
  const canFinish = stage === "setup" && ready && !leaving

  useEffect(() => {
    if (still) return
    const timers = TIMELINE.map(([next, at]) =>
      window.setTimeout(() => setStage(next), at)
    )
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [still])

  useEffect(() => {
    const audio = new Audio(music)
    audio.volume = 0.6
    audio.play().catch(() => {})
    return () => audio.pause()
  }, [])

  function finish() {
    startLeaving(async () => {
      await finishFirstRun()
      onDone()
    })
  }

  // Return goes on once the arrow is there.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Enter" && canFinish) finish()
  })
  useEffect(() => {
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const mascot = MASCOT[stage]
  const y =
    stage === "night"
      ? below + 90
      : stage === "dawn"
        ? below - 20
        : stage === "rise"
          ? 48
          : 0
  return (
    <motion.div
      className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden bg-background"
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={{ duration: 0.6, ease: EASE }}
    >
      <div
        data-tauri-drag-region
        className="absolute inset-x-0 top-0 h-titlebar"
      />
      <DayGlow daypart={daypart} stage={stage} duration={TAKES[stage] * 1000} />
      <FilmGrain />

      <motion.div
        layout
        className="relative flex flex-col items-center"
        transition={{ duration: 1.2, ease: EASE }}
      >
        <motion.div
          layout
          initial={false}
          animate={{ y, width: mascot.size, height: mascot.size }}
          transition={{ duration: TAKES[stage], ease: EASE }}
        >
          <Mascot depth state={mascot.state} className="size-full" />
        </motion.div>

        <AnimatePresence mode="popLayout" initial={false}>
          {stage === "awake" && (
            <motion.div
              key="hello"
              className="mt-[18px] flex flex-col items-center gap-[18px]"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 1, ease: EASE, delay: 0.4 }}
            >
              <h1 className="font-heading text-[40px] leading-[44px] font-bold tracking-[-0.035em]">
                {GREETING[daypart]}, I'm bomby.
              </h1>
              <p className="text-[15px] leading-5 text-foreground/60">
                Let's set up your first agent.
              </p>
            </motion.div>
          )}
          {stage === "setup" && (
            <motion.div
              key={step}
              initial={still ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 1, ease: EASE, delay: 0.5 }}
            >
              {step === "keys" && keys ? (
                <KeysStep keys={keys} />
              ) : (
                <FirstAgent
                  agents={agents}
                  agent={agent}
                  allSet={ready}
                  onChoose={setChosen}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <span className="absolute bottom-[22px] left-6 rounded-full bg-claude px-2.5 py-1 font-mono text-[11px] leading-[14px] font-semibold tracking-[0.08em] text-claude-foreground uppercase">
        Beta
      </span>

      <AnimatePresence>
        {stage === "setup" && ready && (
          <motion.button
            type="button"
            aria-label="Continue"
            className="group absolute right-6 bottom-5 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_10px_24px_-12px_rgb(18_18_18/0.55)] outline-none focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-ring dark:shadow-[0_10px_28px_-12px_rgb(232_255_58/0.5)]"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.96 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.6 }}
            disabled={leaving}
            onClick={finish}
          >
            <ArrowRight
              className="size-5 transition-transform duration-300 group-hover:translate-x-0.5"
              strokeWidth={2.25}
            />
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
