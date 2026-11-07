import { cn } from "@/lib/utils"

import type { ChangeStatus } from "./api"
import { STATUS_COLOR, STATUS_LABEL, STATUS_LETTER } from "./status"

/** A file's git status as one coloured letter (M, U, A, R, D), named for screen readers. */
export function StatusLetter({
  status,
  className,
}: {
  status: ChangeStatus
  className?: string
}) {
  return (
    <span
      title={STATUS_LABEL[status]}
      aria-label={STATUS_LABEL[status]}
      className={cn(
        "w-3 shrink-0 text-center font-mono text-xs font-semibold",
        STATUS_COLOR[status],
        className
      )}
    >
      {STATUS_LETTER[status]}
    </span>
  )
}
