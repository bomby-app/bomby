import type { ReactNode } from "react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * Wraps a call button that `missing` keeps disabled, so hovering it says why (a disabled
 * button gets no pointer events of its own).
 */
export function CallGate({
  missing,
  children,
}: {
  missing: string | null
  children: ReactNode
}) {
  if (!missing) return children
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{missing}</TooltipContent>
    </Tooltip>
  )
}
