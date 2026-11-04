import "./day-glow.css"
import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

export type Daypart = "morning" | "afternoon" | "evening"

/**
 * How far the glow has risen: the splash's four stages (Paper "splash", option A), and
 * `rest` for a page that just sits in it (Paper "projects view").
 */
export type GlowStage = "dawn" | "rise" | "awake" | "setup" | "rest"

/** Morning until noon, afternoon until five, evening after that and through the night. */
export function daypartAt(date: Date): Daypart {
  const hour = date.getHours()
  if (hour >= 5 && hour < 12) return "morning"
  if (hour >= 12 && hour < 17) return "afternoon"
  return "evening"
}

/** The part of the day on this Mac's clock, checked every minute. */
export function useDaypart(): Daypart {
  const [daypart, setDaypart] = useState(() => daypartAt(new Date()))
  useEffect(() => {
    const timer = window.setInterval(
      () => setDaypart(daypartAt(new Date())),
      60_000
    )
    return () => window.clearInterval(timer)
  }, [])
  return daypart
}

/**
 * The glow that rises from the bottom of a page, coloured by the time of day and the theme.
 * A new `stage` animates in over `duration` ms, like a sunrise.
 */
export function DayGlow({
  daypart,
  stage,
  duration = 800,
  className,
}: {
  daypart: Daypart
  stage: GlowStage
  duration?: number
  className?: string
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("day-glow", className)}
      data-daypart={daypart}
      data-stage={stage}
      style={{ "--day-glow-duration": `${duration}ms` } as React.CSSProperties}
    >
      <span className="day-glow-wide" />
      <span className="day-glow-core" />
    </div>
  )
}
