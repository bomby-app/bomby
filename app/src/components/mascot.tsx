import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

/**
 * Dot Dot, the mascot (docs/brand.md, Paper boards "04 Mascot states" and "05 Motion").
 * The bubble never changes shape or colour; only the eyes do. The bubble scales with sound
 * while listening or talking, and nothing else moves it.
 *
 * Working and done (a Claude session running, a result arriving) join when Claude's status
 * events reach the app.
 */
export type MascotState =
  | "waking"
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "asleep"
  | "failed"

// The mark in a 120 viewBox: one square corner (bottom left), two eyes.
const BUBBLE =
  "M60 18 A42 42 0 0 1 102 60 A42 42 0 0 1 60 102 H18 V60 A42 42 0 0 1 60 18 Z"
const EYES = [47, 73] as const
const EYE_Y = 58

/** Blinks every 3 to 6 seconds (140 ms), as the motion board says. */
function useBlink(enabled: boolean) {
  const [closed, setClosed] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let timer: number
    const schedule = () => {
      timer = window.setTimeout(
        () => {
          setClosed(true)
          timer = window.setTimeout(() => {
            setClosed(false)
            schedule()
          }, 140)
        },
        3000 + Math.random() * 3000
      )
    }
    schedule()
    return () => window.clearTimeout(timer)
  }, [enabled])
  return enabled && closed
}

export function Mascot({
  state,
  level = 0,
  size = 120,
  bubble = "var(--sidebar-primary)",
  eyes = "var(--sidebar-primary-foreground)",
  className,
}: {
  state: MascotState
  /** 0 to 1: the mic while listening, the agent's voice while talking. */
  level?: number
  size?: number
  /** Fill colours; the defaults flip with the theme like the logo tile. */
  bubble?: string
  eyes?: string
  className?: string
}) {
  const blinking = useBlink(state === "idle" || state === "listening")
  const sound = Math.min(1, Math.max(0, level))
  // Listen breathe: up to 1.06; speak pulse: up to 1.05. Silence means stillness.
  const scale =
    state === "listening"
      ? 1 + 0.06 * sound
      : state === "speaking"
        ? 1 + 0.05 * sound
        : 1
  const bubbleFill = state === "asleep" ? "var(--muted-foreground)" : bubble

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role="img"
      aria-label={`Claudible, ${state}`}
      className={cn(
        "shrink-0 overflow-visible",
        state === "failed" && "motion-safe:animate-dotdot-shake",
        className
      )}
    >
      <path
        d={BUBBLE}
        fill={bubbleFill}
        style={{
          transform: `scale(${scale})`,
          transformBox: "fill-box",
          transformOrigin: "center",
          transition: "transform 80ms linear, fill 200ms ease-out",
          opacity: state === "asleep" ? 0.45 : 1,
        }}
      />
      <g
        className={cn(
          "transition-transform duration-[400ms] ease-out",
          state === "thinking" && "motion-safe:animate-dotdot-wander"
        )}
        style={{
          transform:
            state === "thinking"
              ? "translate(5px, -6px)"
              : state === "listening"
                ? "translate(0, -3px)"
                : undefined,
        }}
      >
        {EYES.map((cx) => (
          <Eye
            key={cx}
            cx={cx}
            state={state}
            level={sound}
            blinking={blinking}
            fill={state === "asleep" ? "var(--background)" : eyes}
          />
        ))}
      </g>
    </svg>
  )
}

function Eye({
  cx,
  state,
  level,
  blinking,
  fill,
}: {
  cx: number
  state: MascotState
  level: number
  blinking: boolean
  fill: string
}) {
  // Eyes closed: waking (before the agent is ready) and asleep (the call ended).
  if (state === "waking" || state === "asleep") {
    return (
      <rect
        x={cx - 8}
        y={EYE_Y - 1.75}
        width={16}
        height={3.5}
        rx={1.75}
        fill={fill}
      />
    )
  }
  // Failed: crossed eyes in bubblegum.
  if (state === "failed") {
    const d = 5.5
    return (
      <path
        d={`M${cx - d} ${EYE_Y - d} L${cx + d} ${EYE_Y + d} M${cx + d} ${EYE_Y - d} L${cx - d} ${EYE_Y + d}`}
        stroke="var(--claude)"
        strokeWidth={3.5}
        strokeLinecap="round"
      />
    )
  }
  // Talking: ovals that open a little on loud syllables.
  const rx = state === "listening" ? 10.5 : 7
  const ry =
    state === "speaking" ? 4.5 + 1.5 * level : state === "listening" ? 10.5 : 7
  return (
    <ellipse
      cx={cx}
      cy={EYE_Y}
      rx={rx}
      ry={ry}
      fill={fill}
      style={{
        transform: blinking ? "scaleY(0.1)" : "scaleY(1)",
        transformBox: "fill-box",
        transformOrigin: "center",
        transition:
          "transform 70ms ease-in-out, rx 200ms ease-out, ry 120ms ease-out",
      }}
    />
  )
}

/** The mascot's state for LiveKit's agent state (`useAgent().state`). */
export function mascotState(agent: string): MascotState {
  switch (agent) {
    case "listening":
      return "listening"
    case "thinking":
      return "thinking"
    case "speaking":
      return "speaking"
    case "idle":
      return "idle"
    case "failed":
      return "failed"
    case "disconnected":
      return "asleep"
    default:
      return "waking" // connecting, pre-connect-buffering, initializing
  }
}
