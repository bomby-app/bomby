import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import { ArrowRight } from "lucide-react"
import { useReducedMotion } from "motion/react"
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useTransition,
} from "react"

import music from "@/assets/splash-music.mp3"
import {
  DayGlow,
  type Daypart,
  type GlowStage,
  useDaypart,
} from "@/components/day-glow"
import { FilmGrain } from "@/components/film-grain"
import { Mascot, type MascotState } from "@/components/mascot"
import { isReady, useAgents } from "@/features/agents/use-agents"
import { useSavedKeys } from "@/features/credentials/use-saved-keys"

import { finishFirstRun } from "./api"
import { FirstAgent, firstAgent } from "./first-agent"
import { KeysStep } from "./keys-step"

gsap.registerPlugin(useGSAP)

/**
 * The first run (Paper "splash", option A), one GSAP timeline with nothing overlapping:
 * the glow comes up while Bomby rises with its eyes closed, opens them as it arrives and
 * looks around, says hello, lets the hello go, then moves up for the setup to fade in
 * under it.
 * Setup is the agent, then, one more step, the LiveKit and Gemini keys; steps already done
 * are skipped. The round arrow on comes only once a call has all three, and nothing gets
 * past it before that: the app can't work without them.
 */

const GREETING: Record<Daypart, string> = {
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
}

// Where the 120 px mascot box sits, its top relative to the window's middle (px): high
// enough for the hello under it, then small above the setup (scale 0.5, 10 px over it).
const HELLO_Y = -124
const SETUP_Y = -220
const SETUP_TOP = "calc(50% - 120px)"

/** How long the glow takes to reach each stage (day-glow.css eases it). */
const GLOW_TAKES: Partial<Record<GlowStage, number>> = {
  rise: 3200,
  awake: 2400,
  setup: 2200,
}

// No overshoot anywhere (Paper "05 Motion"): arrivals slow down, moves ease both ways.
const EASE = "power2.inOut"

export function Splash({ onDone }: { onDone: () => void }) {
  const still = useReducedMotion() === true
  const daypart = useDaypart()
  const [glow, setGlow] = useState<GlowStage>(still ? "setup" : "night")
  const [mascot, setMascot] = useState<MascotState>(
    still ? "listening" : "waking"
  )
  const [look, setLook] = useState(0)
  const [introDone, setIntroDone] = useState(still)
  const [leaving, startLeaving] = useTransition()

  const { agents } = useAgents()
  const [chosen, setChosen] = useState<string | null>(null)
  const agent = firstAgent(agents, chosen)
  const { keys } = useSavedKeys()
  const agentReady = agent !== null && isReady(agent)
  const keysReady = keys !== null && keys.livekit && keys.gemini
  const ready = agentReady && keysReady
  // The keys come once the agent is ready; with both, the agent's card says all is set.
  const step = agentReady && keys !== null && !keysReady ? "keys" : "agent"
  // The step on screen: it follows `step`, fading out, then in.
  const [shown, setShown] = useState(step)
  const latestStep = useRef(step)
  useEffect(() => {
    latestStep.current = step
  })

  const root = useRef<HTMLDivElement>(null)
  const mascotBox = useRef<HTMLDivElement>(null)
  const hello = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const arrow = useRef<HTMLButtonElement>(null)

  // The intro, once.
  useGSAP(
    () => {
      if (still) {
        gsap.set(mascotBox.current, { y: SETUP_Y, scale: 0.5 })
        gsap.set(content.current, { autoAlpha: 1 })
        return
      }
      gsap.set(mascotBox.current, {
        y: window.innerHeight / 2 + 40,
        scale: 112 / 120,
      })
      gsap
        .timeline({
          defaults: { ease: EASE },
          onComplete: () => {
            setShown(latestStep.current)
            setIntroDone(true)
          },
        })
        .call(() => setGlow("rise"), [], 0.1)
        // Floats up, slowing as it arrives, eyes closed.
        .to(
          mascotBox.current,
          { y: HELLO_Y, duration: 3.2, ease: "power3.out" },
          0.2
        )
        // Arrived: the eyes open, and it settles to full size.
        .call(
          () => {
            setMascot("idle")
            setGlow("awake")
          },
          [],
          ">-0.4"
        )
        .to(
          mascotBox.current,
          { scale: 1, duration: 1, ease: "power2.out" },
          "<"
        )
        // A look around (the eyes ease over in 450 ms), then back at you.
        .call(() => setLook(-4), [], "+=0.2")
        .call(() => setLook(4), [], "+=0.9")
        .call(() => setLook(0), [], "+=0.9")
        .fromTo(
          hello.current,
          { autoAlpha: 0, y: 10 },
          { autoAlpha: 1, y: 0, duration: 1.1, ease: "power2.out" },
          "+=0.3"
        )
        .to(hello.current, { autoAlpha: 0, y: -6, duration: 0.8 }, "+=2.4")
        .call(() => setGlow("setup"), [], ">+0.1")
        .to(mascotBox.current, { y: SETUP_Y, scale: 0.5, duration: 1.4 }, "<")
        .call(() => setMascot("listening"))
        .fromTo(
          content.current,
          { autoAlpha: 0, y: 14 },
          { autoAlpha: 1, y: 0, duration: 1.1, ease: "power2.out" },
          ">+0.1"
        )
    },
    { scope: root }
  )

  // A new step after the intro: the old one fades out, then the new one in.
  useGSAP(
    () => {
      if (!introDone || step === shown) return
      gsap.to(content.current, {
        autoAlpha: 0,
        y: -8,
        duration: 0.6,
        ease: EASE,
        onComplete: () => {
          // The next step comes up from a little lower.
          gsap.set(content.current, { y: 14 })
          setShown(latestStep.current)
        },
      })
    },
    { dependencies: [step, shown, introDone], scope: root }
  )
  useGSAP(
    () => {
      if (!introDone) return
      gsap.to(content.current, { autoAlpha: 1, y: 0, duration: 1, ease: EASE })
    },
    { dependencies: [shown, introDone], scope: root }
  )

  // The arrow, once everything is ready.
  useGSAP(
    () => {
      if (!introDone || !ready) return
      gsap.fromTo(
        arrow.current,
        { autoAlpha: 0, scale: 0.85 },
        { autoAlpha: 1, scale: 1, duration: 0.8, ease: "sine.out", delay: 0.4 }
      )
    },
    { dependencies: [introDone, ready], scope: root }
  )

  useEffect(() => {
    const audio = new Audio(music)
    audio.volume = 0.6
    audio.play().catch(() => {})
    return () => audio.pause()
  }, [])

  // The fade out ends before the splash unmounts, so it needs no context to clean up.
  function finish() {
    gsap.to(root.current, {
      autoAlpha: 0,
      duration: 0.7,
      ease: EASE,
      onComplete: () =>
        startLeaving(async () => {
          await finishFirstRun()
          onDone()
        }),
    })
  }

  // Return goes on once the arrow is there.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Enter" && introDone && ready && !leaving) finish()
  })
  useEffect(() => {
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <div ref={root} className="fixed inset-0 overflow-hidden bg-background">
      <div
        data-tauri-drag-region
        className="absolute inset-x-0 top-0 h-titlebar"
      />
      <DayGlow daypart={daypart} stage={glow} duration={GLOW_TAKES[glow]} />
      <FilmGrain />

      <div
        ref={mascotBox}
        className="absolute top-1/2 left-1/2 -ml-[60px] size-[120px]"
      >
        <Mascot depth state={mascot} look={look} className="size-full" />
      </div>

      <div
        ref={hello}
        className="invisible absolute inset-x-0 top-1/2 mt-3.5 flex flex-col items-center gap-[18px]"
      >
        <h1 className="font-heading text-[40px] leading-[44px] font-bold tracking-[-0.035em]">
          {GREETING[daypart]}, I'm bomby.
        </h1>
        <p className="text-[15px] leading-5 text-foreground/60">
          Let's set up your first agent.
        </p>
      </div>

      <div
        ref={content}
        className="invisible absolute inset-x-0 flex justify-center"
        style={{ top: SETUP_TOP }}
      >
        {shown === "keys" && keys ? (
          <KeysStep keys={keys} />
        ) : (
          <FirstAgent
            agents={agents}
            agent={agent}
            allSet={ready}
            onChoose={setChosen}
          />
        )}
      </div>

      <span className="absolute bottom-[22px] left-6 rounded-full bg-claude px-2.5 py-1 font-mono text-[11px] leading-[14px] font-semibold tracking-[0.08em] text-claude-foreground uppercase">
        Beta
      </span>

      {introDone && ready && (
        <button
          ref={arrow}
          type="button"
          aria-label="Continue"
          disabled={leaving}
          className="group invisible absolute right-6 bottom-5 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_10px_24px_-12px_rgb(18_18_18/0.55)] outline-none focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-ring dark:shadow-[0_10px_28px_-12px_rgb(232_255_58/0.5)]"
          onClick={finish}
        >
          <ArrowRight
            className="size-5 transition-transform duration-300 group-hover:translate-x-0.5"
            strokeWidth={2.25}
          />
        </button>
      )}
    </div>
  )
}
