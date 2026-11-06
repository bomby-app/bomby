import { useAgent, useSessionContext } from "@livekit/components-react"
import { X } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useState } from "react"

import { MascotCard } from "@/components/mascot-card"
import { Button } from "@/components/ui/button"

// What the voice agent sets when this call has no memory because Zep can't be reached
// (agent/memory.py).
const ATTRIBUTE = "bomby.memory"

/**
 * The card a call shows when Bomby can't reach its memory: the failed mascot, and the call
 * going on as usual. Closed for the rest of the call once the user closes it.
 */
export function MemoryUnavailable({ className }: { className?: string }) {
  const session = useSessionContext()
  const { attributes } = useAgent(session)
  const [closed, setClosed] = useState(false)
  const shown = attributes[ATTRIBUTE] === "unavailable" && !closed

  return (
    <AnimatePresence>
      {shown && (
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
                onClick={() => setClosed(true)}
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
