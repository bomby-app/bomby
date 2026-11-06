import type { VoiceProvider } from "./api"

/**
 * Where the user gets each provider's key. Settings, Voice (the settings window) and the
 * splash (the main window) open them, so each window's capability allows every one
 * (`src-tauri/capabilities/`; a test checks it).
 */
export const KEY_PAGES: Record<VoiceProvider, string> = {
  gemini: "https://aistudio.google.com/apikey",
  openai: "https://platform.openai.com/api-keys",
  rime: "https://app.rime.ai/tokens",
}
