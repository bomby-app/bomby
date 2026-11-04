import { isReady, useAgents } from "@/features/agents/use-agents"
import { useSavedKeys } from "@/features/credentials/use-saved-keys"

/**
 * Whether a call can start: the LiveKit keys, the Gemini key and an agent that's set up.
 * `missing` says what isn't, for the disabled Call button; null while still checking.
 */
export function useCallReadiness(): { ready: boolean; missing: string | null } {
  const { keys } = useSavedKeys()
  const { agents } = useAgents()
  if (keys === null || agents === null) return { ready: false, missing: null }
  if (!keys.livekit)
    return { ready: false, missing: "Add your LiveKit keys in Settings first." }
  if (!keys.gemini)
    return { ready: false, missing: "Add your Gemini key in Settings first." }
  if (!agents.some(isReady))
    return { ready: false, missing: "Set up an agent in Settings first." }
  return { ready: true, missing: null }
}
