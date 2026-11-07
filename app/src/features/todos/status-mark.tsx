import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

import type { TodoStatus } from "./api"

/**
 * A to-do's status as one 16 px mark (Paper "extensions", 04): an empty circle to do, a
 * half-filled one doing, a highlighter disc with an ink tick done (brand.md: good news is a
 * disc, never a bare lime icon), a slashed grey circle cancelled.
 */
export function StatusMark({
  status,
  className,
}: {
  status: TodoStatus
  className?: string
}) {
  if (status === "done") {
    return (
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full bg-highlighter text-highlighter-foreground",
          className
        )}
      >
        <Check className="size-2.5" strokeWidth={4} />
      </span>
    )
  }
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={cn(
        "size-4 shrink-0",
        status === "cancelled" ? "text-muted-foreground/70" : "",
        status === "todo" ? "text-muted-foreground" : "",
        status === "doing" ? "text-foreground" : "",
        className
      )}
    >
      <circle
        cx="8"
        cy="8"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {status === "doing" && (
        <path d="M8 3.5a4.5 4.5 0 0 1 0 9z" fill="currentColor" />
      )}
      {status === "cancelled" && (
        <path
          d="M5 11 11 5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      )}
    </svg>
  )
}
