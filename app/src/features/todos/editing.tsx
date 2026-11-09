import { commandShortcut } from "@/lib/shortcuts"
import { cn } from "@/lib/utils"

import { remaining } from "./limits"

// What editing a to-do's words shares, in its row and in the dialog.

/** Saves a to-do from its words, in its row or the dialog. */
export const SAVE_SHORTCUT = commandShortcut("Enter")
/** Opens a to-do being edited in its row in the dialog, for longer notes. */
export const EXPAND_SHORTCUT = commandShortcut("e")

/** How many characters are left, once close to the limit; red past it. */
export function Left({
  text,
  max,
  className,
}: {
  text: string
  max: number
  className?: string
}) {
  const left = remaining(text, max)
  if (left === null) return null
  return (
    <span
      aria-live="polite"
      className={cn(
        "shrink-0 font-mono text-xs text-muted-foreground tabular-nums",
        left < 0 && "text-destructive",
        className
      )}
    >
      {left}
    </span>
  )
}
