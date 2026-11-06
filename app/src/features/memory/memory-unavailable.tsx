import { X } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"

import { MascotCard } from "@/components/mascot-card"
import { Button } from "@/components/ui/button"
import { createStore, useStore } from "@/lib/store"

// What the voice agent sets when the call has no memory (agent/memory.py).
const ATTRIBUTE = "bomby.memory"

// The call (its `startedAt`) whose card the user closed; outlives the call view, which
// unmounts while the user looks at another project.
const closedFor = createStore<number | null>(null)

/** Whether the agent says this call can't reach its memory. */
export function memoryUnavailable(attributes: Record<string, string>): boolean {
  return attributes[ATTRIBUTE] === "unavailable"
}

/**
 * The card a call shows when Bomby can't reach its memory: the failed mascot, and the call
 * going on as usual. Once closed, it stays closed for the rest of the call.
 */
export function MemoryUnavailable({
  call,
  unavailable,
  className,
}: {
  /** The call's `startedAt`. */
  call: number
  unavailable: boolean
  className?: string
}) {
  const closed = useStore(closedFor) === call

  return (
    <AnimatePresence>
      {unavailable && !closed && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className={className}
        >
          <MascotCard
            state="failed"
            headline="I have no memory!"
            detail="I can't reach it right now. The call works as usual."
            announce="status"
            action={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close"
                onClick={() => closedFor.set(call)}
              >
                <X />
              </Button>
            }
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
