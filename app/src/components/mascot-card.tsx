import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

import { Mascot, type MascotState } from "./mascot"

/**
 * A card where the mascot says something to the user: its face, a headline, a line under
 * it and a way forward. The error card (failed) and the update card (done) are this card,
 * so they always look alike.
 */
export function MascotCard({
  state,
  headline,
  detail,
  action,
  announce,
  className,
}: {
  state: MascotState
  headline: ReactNode
  detail?: ReactNode
  /** The button that moves things on, such as Try again. */
  action?: ReactNode
  /** How screen readers hear it: at once (an error), or when they're free (news). */
  announce?: "alert" | "status"
  className?: string
}) {
  const classes = cn(
    "flex items-center gap-4 rounded-xl border bg-card px-4 py-3.5 text-card-foreground",
    className
  )
  const body = (
    <>
      <Mascot state={state} size={40} className="shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium">{headline}</p>
        {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </>
  )
  // <output> is a status region of its own.
  return announce === "status" ? (
    <output className={classes}>{body}</output>
  ) : (
    <div role={announce} className={classes}>
      {body}
    </div>
  )
}
