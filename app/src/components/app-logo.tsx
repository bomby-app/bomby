import { AudioLines } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Placeholder mark until the branding stage. Every place that shows the logo renders this
 * component, so swapping in the real mark is a change to this file only.
 */
export function AppLogo({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground",
        className
      )}
    >
      <AudioLines className="size-4" />
    </div>
  )
}
