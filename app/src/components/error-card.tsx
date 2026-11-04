import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

import { Mascot } from "./mascot"

/**
 * An error the user should see, with the mascot's failed face (Paper "04 Mascot states",
 * Failed: crossed eyes in bubblegum). `message` follows the voice in docs/brand.md, what
 * happened and then what to do: its first sentence is the headline, the rest sits under
 * it ("The folder samba isn't there any more." / "Add it again in Project settings.").
 * Never a raw error: those go to the log.
 */
export function ErrorCard({
  message,
  action,
  className,
}: {
  message: string
  /** A way out, such as a Try again button. */
  action?: ReactNode
  className?: string
}) {
  const [headline, detail] = splitMessage(message)
  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-4 rounded-xl border bg-card px-4 py-3.5 text-card-foreground",
        className
      )}
    >
      <Mascot state="failed" size={40} className="shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium">{headline}</p>
        {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/** The first sentence, and the rest if there is any. */
function splitMessage(message: string): [string, string | null] {
  const match = /^(.+?[.?!])\s+(.+)$/s.exec(message.trim())
  return match ? [match[1], match[2]] : [message.trim(), null]
}
