import { useSavedKeys } from "@/features/call-server/use-saved-keys"
import { PROVIDERS } from "@/features/voice/providers"

/**
 * Whether a call can start: the LiveKit keys and the voice provider's key. An agent isn't needed to
 * talk; with none, the voice says how to get one (docs/decisions/detect-acp-native-agents.md).
 * `missing` says what isn't there, or why the keys couldn't be read, for the disabled Call
 * button; null while still checking.
 */
export function useCallReadiness(): { ready: boolean; missing: string | null } {
  const { keys, error } = useSavedKeys()
  // A read that failed says why, so a disabled Call explains itself (the menu bar too).
  if (keys === null) return { ready: false, missing: error }
  if (!keys.livekit)
    return { ready: false, missing: "Add your LiveKit keys in Settings first." }
  if (!keys.voiceKey)
    return {
      ready: false,
      missing: `Add your ${PROVIDERS[keys.voice].name} key in Settings first.`,
    }
  return { ready: true, missing: null }
}
