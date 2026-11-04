import { ArrowRight } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useEffect, useRef, useState, useTransition } from "react"

import music from "@/assets/splash-music.mp3"
import { DayGlow, type Daypart, useDaypart } from "@/components/day-glow"
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
type Stage = "dawn" | "rise" | "awake" | "setup"

// When each stage starts, in ms (the Paper artboards' timings, with time to read hello).
const TIMELINE: [Stage, number][] = [
  ["rise", 600],
  ["awake", 1400],
  ["setup", 2800],
]

const GREETING: Record<Daypart, string> = {
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
}

const MASCOT: Record<Stage, { size: number; state: MascotState }> = {
  dawn: { size: 112, state: "waking" },
  rise: { size: 112, state: "waking" },
  awake: { size: 120, state: "idle" },
  setup: { size: 60, state: "listening" },
}

const EASE = [0.22, 1, 0.36, 1] as const

export function Splash({ onDone }: { onDone: () => void }) {
  const still = useReducedMotion() === true
  const daypart = useDaypart()
  const [stage, setStage] = useState<Stage>(still ? "setup" : "dawn")
  const [leaving, startLeaving] = useTransition()
  // Below the window at dawn, peeking up (Paper: 240 px down in a 520 px window).
  const [dawnY] = useState(() => window.innerHeight / 2 - 20)
  const { agents } = useAgents()
  const [chosen, setChosen] = useState<string | null>(null)
  const agent = firstAgent(agents, chosen)
  const { keys } = useSavedKeys()
  const agentReady = agent !== null && isReady(agent)
  const keysReady = keys !== null && keys.livekit && keys.gemini
  const ready = agentReady && keysReady
  // The keys come once the agent is ready; with both, the agent's card says all is set.
  const step = agentReady && keys !== null && !keysReady ? "keys" : "agent"
  const next = useRef<HTMLButtonElement>(null)

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

  // The arrow takes focus when it appears, so Return goes on.
  useEffect(() => {
    if (stage === "setup" && ready) next.current?.focus()
  }, [stage, ready])

  function finish() {
    startLeaving(async () => {
      await finishFirstRun()
      onDone()
    })
  }

  const mascot = MASCOT[stage]
  return (
    <motion.div
      className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden bg-background"
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={{ duration: 0.4, ease: EASE }}
    >
      <div
        data-tauri-drag-region
        className="absolute inset-x-0 top-0 h-titlebar"
      />
      <DayGlow
        daypart={daypart}
        stage={stage}
        duration={stage === "setup" ? 1000 : 800}
      />

      <motion.div
        layout
        className="relative flex flex-col items-center"
        transition={{ duration: 0.7, ease: EASE }}
      >
        <motion.div
          layout
          initial={false}
          animate={{
            y: stage === "dawn" ? dawnY : stage === "rise" ? 48 : 0,
            width: mascot.size,
            height: mascot.size,
          }}
          transition={{ duration: stage === "rise" ? 0.6 : 0.8, ease: EASE }}
        >
          <Mascot depth state={mascot.state} className="size-full" />
        </motion.div>

        <AnimatePresence mode="popLayout" initial={false}>
          {stage === "awake" && (
            <motion.div
              key="hello"
              className="mt-[18px] flex flex-col items-center gap-[18px]"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.5, ease: EASE }}
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
              initial={still ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.1 }}
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
            ref={next}
            aria-label="Continue"
            className="absolute right-6 bottom-5 flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.35, ease: EASE, delay: 0.4 }}
            disabled={leaving}
            onClick={finish}
          >
            <ArrowRight className="size-5" />
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
