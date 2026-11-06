import type { VoiceProvider } from "./api"

/** How the app names each provider, in copy like "Add your Rime key". */
export const VOICE_NAMES: Record<VoiceProvider, string> = {
  gemini: "Gemini",
  rime: "Rime",
}
