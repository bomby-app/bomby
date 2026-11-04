import { useReducedMotion } from "motion/react"
import { useEffect, useId, useState } from "react"

import { cn } from "@/lib/utils"

/**
 * Dot Dot, the mascot (docs/brand.md, Paper boards "04 Mascot states" and "05 Motion").
 * The bubble never changes shape or colour; only the eyes do. The bubble scales with sound
 * while listening or talking, and nothing else moves it.
 *
 * With `depth`, it is the lit version from the splash (Paper "splash"): gradients, a rim
 * of light and catchlights in the eyes, in the theme's mascot colours.
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
// The light along the top of the bubble, with depth.
const RIM = "M27 44 A38.5 38.5 0 0 1 93 44"
const EYES = [47, 73] as const
const EYE_Y = 58

/**
 * Blinks (140 ms) at a random moment in [min, max] ms: every 3 to 6 seconds at rest, as
 * the motion board says, more often while talking. Now and then it blinks twice.
 */
function useBlink(enabled: boolean, [min, max] = [3000, 6000]) {
  const [closed, setClosed] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let timer: number
    const blink = (then: () => void) => {
      setClosed(true)
      timer = window.setTimeout(() => {
        setClosed(false)
        then()
      }, 140)
    }
    const schedule = () => {
      timer = window.setTimeout(
        () =>
          blink(() => {
            if (Math.random() < 0.2) {
              timer = window.setTimeout(() => blink(schedule), 120)
            } else schedule()
          }),
        min + Math.random() * (max - min)
      )
    }
    schedule()
    return () => window.clearTimeout(timer)
  }, [enabled, min, max])
  return enabled && closed
}

// Where the eyes look while talking, in viewBox units: left, right, or at you.
const GLANCES = [-4, -2.5, 0, 2.5, 4] as const

/** While talking, the eyes glance somewhere new every 1 to 2.5 seconds. */
function useGlance(enabled: boolean) {
  const [x, setX] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let timer: number
    const schedule = () => {
      timer = window.setTimeout(
        () => {
          setX((current) => {
            const others = GLANCES.filter((g) => g !== current)
            return others[Math.floor(Math.random() * others.length)] ?? 0
          })
          schedule()
        },
        1000 + Math.random() * 1500
      )
    }
    schedule()
    return () => window.clearTimeout(timer)
  }, [enabled])
  return enabled ? x : 0
}

export function Mascot({
  state,
  level = 0,
  size = 120,
  bubble = "var(--sidebar-primary)",
  eyes = "var(--sidebar-primary-foreground)",
  depth = false,
  look = 0,
  className,
}: {
  state: MascotState
  /** 0 to 1: the mic while listening, the agent's voice while talking. */
  level?: number
  size?: number
  /** Fill colours; the defaults flip with the theme like the logo tile. */
  bubble?: string
  eyes?: string
  depth?: boolean
  /** Where the eyes look, in viewBox units: negative is left. */
  look?: number
  className?: string
}) {
  const id = useId()
  // Reduced motion and small sizes: no loops (the blink stays).
  const still = useReducedMotion() === true || size < 32
  const blinking = useBlink(
    state === "idle" || state === "listening" || state === "speaking",
    state === "speaking" ? [1800, 4000] : undefined
  )
  const glance = useGlance(state === "speaking" && !still)
  const sound = Math.min(1, Math.max(0, level))
  // Listen breathe: up to 1.06; speak pulse: up to 1.05. Silence means stillness.
  const scale =
    state === "listening"
      ? 1 + 0.06 * sound
      : state === "speaking"
        ? 1 + 0.05 * sound
        : 1
  const lit = depth && state !== "asleep"
  const bubbleFill =
    state === "asleep"
      ? "var(--muted-foreground)"
      : lit
        ? `url(#${id}-body)`
        : bubble
  const eyeFill =
    state === "asleep" ? "var(--background)" : lit ? `url(#${id}-eye)` : eyes

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      // An inline SVG is labelled for screen readers with role="img", not an <img>.
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="img"
      aria-label={`Bomby, ${state}`}
      className={cn(
        "shrink-0 overflow-visible",
        state === "failed" && "motion-safe:animate-dotdot-shake",
        className
      )}
      style={lit ? { filter: "var(--mascot-shadow)" } : undefined}
    >
      {lit && (
        <defs>
          <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--mascot-body-top)" />
            <stop offset="0.5" stopColor="var(--mascot-body-middle)" />
            <stop offset="1" stopColor="var(--mascot-body-bottom)" />
          </linearGradient>
          <linearGradient id={`${id}-eye`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--mascot-eye-top)" />
            <stop offset="1" stopColor="var(--mascot-eye-bottom)" />
          </linearGradient>
          <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--mascot-rim)" stopOpacity="0" />
            <stop offset="0.5" stopColor="var(--mascot-rim)" />
            <stop offset="1" stopColor="var(--mascot-rim)" stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
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
      {lit && (
        <path
          d={RIM}
          fill="none"
          stroke={`url(#${id}-rim)`}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      )}
      <g
        className={cn(
          "transition-transform duration-[450ms] ease-in-out",
          state === "thinking" && "motion-safe:animate-dotdot-wander"
        )}
        style={{
          transform:
            state === "thinking"
              ? "translate(5px, -6px)"
              : state === "listening"
                ? `translate(${look}px, -3px)`
                : state === "speaking"
                  ? `translate(${glance}px, -1px)`
                  : `translate(${look}px, 0)`,
        }}
      >
        {EYES.map((cx) => (
          <Eye
            key={cx}
            cx={cx}
            state={state}
            level={sound}
            blinking={blinking}
            fill={eyeFill}
            lit={lit}
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
  lit,
}: {
  cx: number
  state: MascotState
  level: number
  blinking: boolean
  fill: string
  lit: boolean
}) {
  // With depth, closed eyes are Paper's curved lids (board "04 Mascot states", Done), and
  // opening crossfades them into round eyes that open from a squint. The blink is its own
  // layer, so it stays quick while opening is slow.
  if (lit && state !== "asleep" && state !== "failed") {
    const closed = state === "waking"
    const r =
      state === "listening" ? 10.5 : state === "speaking" ? 7 + 1.2 * level : 7
    return (
      <g>
        <path
          d={`M${cx - 7} ${EYE_Y + 3} Q${cx} ${EYE_Y - 7} ${cx + 7} ${EYE_Y + 3}`}
          fill="none"
          stroke="var(--mascot-lid)"
          strokeWidth={5}
          strokeLinecap="round"
          style={{
            opacity: closed ? 1 : 0,
            transition: "opacity 360ms ease-out",
          }}
        />
        <g
          style={{
            opacity: closed ? 0 : 1,
            transform: closed ? "scaleY(0.1)" : "scaleY(1)",
            transformBox: "fill-box",
            transformOrigin: "center",
            transition:
              "transform 560ms cubic-bezier(0.22, 1, 0.36, 1), opacity 320ms ease-out",
          }}
        >
          <g
            style={{
              transform: blinking ? "scaleY(0.1)" : "scaleY(1)",
              transformBox: "fill-box",
              transformOrigin: "center",
              transition: "transform 70ms ease-in-out",
            }}
          >
            <ellipse
              cx={cx}
              cy={EYE_Y}
              rx={r}
              ry={r}
              fill={fill}
              style={{ transition: "rx 200ms ease-out, ry 120ms ease-out" }}
            />
            {/* A catchlight, up and to the left as in the Paper board. */}
            <ellipse
              cx={cx - 0.32 * r}
              cy={EYE_Y - 0.34 * r}
              rx={0.24 * r}
              ry={0.24 * r}
              fill="var(--mascot-catchlight)"
              style={{ transition: "all 200ms ease-out" }}
            />
          </g>
        </g>
      </g>
    )
  }
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
  // Failed: crossed eyes in bubblegum (Paper "04 Mascot states", Failed: 10 wide, 4.5 thick).
  if (state === "failed") {
    const d = 5
    return (
      <path
        d={`M${cx - d} ${EYE_Y - d} L${cx + d} ${EYE_Y + d} M${cx + d} ${EYE_Y - d} L${cx - d} ${EYE_Y + d}`}
        stroke="var(--claude)"
        strokeWidth={4.5}
        strokeLinecap="round"
      />
    )
  }
  // Listening: wide open. Talking: round, a little bigger on loud syllables.
  const r =
    state === "listening" ? 10.5 : state === "speaking" ? 7 + 1.2 * level : 7
  return (
    <ellipse
      cx={cx}
      cy={EYE_Y}
      rx={r}
      ry={r}
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
