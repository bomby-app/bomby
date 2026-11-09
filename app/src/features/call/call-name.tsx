import { Pencil } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { showErrorToast } from "@/components/error-toast"
import { InlineEditInput } from "@/components/inline-edit-input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { callLabel } from "@/features/projects/names"
import { cn } from "@/lib/utils"

import { log, renameCall } from "./api"

/** The core's limit on a call's name (`MAX_NAME_LEN` in `src-tauri/src/calls.rs`). */
export const NAME_MAX = 60

/** The call as renaming it needs it. */
type NamedCall = { id: number; name: string | null; startedAt: number }

/**
 * A field for the call's name, open from the start: Enter or leaving it saves, Esc puts
 * it back, and saving no words takes the name away, so the call shows when it started.
 * `onDone` follows either way. Every window hears of the new name from the core
 * (`onCallRenamed`).
 */
export function CallNameInput({
  call,
  onDone,
  className,
}: {
  call: NamedCall
  onDone: () => void
  className?: string
}) {
  // Open to type into: it only shows when the user asks to rename.
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => field.current?.focus(), [])

  async function save(name: string) {
    try {
      await renameCall(call.id, name, "user")
      return true
    } catch (e) {
      log(`Renaming call ${call.id} failed: ${String(e)}`)
      showErrorToast(String(e))
      return false
    }
  }

  return (
    // Leaving the field ends editing, after it saved what's in it (its own blur runs first).
    <span className="contents" onBlur={onDone}>
      <InlineEditInput
        // Typing a name doesn't open anything around it.
        onClick={(event) => event.stopPropagation()}
        ref={field}
        value={call.name ?? ""}
        placeholder={callLabel(call.startedAt)}
        maxLength={NAME_MAX}
        aria-label="Call name"
        spellCheck={false}
        autoComplete="off"
        className={cn("pointer-events-auto h-7 w-64", className)}
        onSave={save}
      />
    </span>
  )
}

/**
 * The call's title in the header, which the user clicks to rename: its name, or
 * `fallback` until it has one.
 */
export function CallName({
  call,
  fallback,
}: {
  call: NamedCall
  fallback: string
}) {
  const [editing, setEditing] = useState(false)
  if (editing)
    return <CallNameInput call={call} onDone={() => setEditing(false)} />
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="group/name pointer-events-auto inline-flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">{call.name ?? fallback}</span>
          <Pencil
            aria-hidden
            className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/name:opacity-100 group-focus-visible/name:opacity-100"
          />
        </button>
      </TooltipTrigger>
      <TooltipContent>Rename call</TooltipContent>
    </Tooltip>
  )
}
