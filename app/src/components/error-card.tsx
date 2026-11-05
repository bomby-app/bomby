import type { ReactNode } from "react"

import { MascotCard } from "./mascot-card"

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
    <MascotCard
      state="failed"
      headline={headline}
      detail={detail}
      action={action}
      announce="alert"
      className={className}
    />
  )
}

/** The first sentence, and the rest if there is any. */
function splitMessage(message: string): [string, string | null] {
  const match = /^(.+?[.?!])\s+(.+)$/s.exec(message.trim())
  return match ? [match[1], match[2]] : [message.trim(), null]
}
