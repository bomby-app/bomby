import { invoke } from "@tauri-apps/api/core"

// The core's voice setting (src-tauri/src/settings.rs): Gemini's 30 prebuilt voices.

export type Voice = { name: string; style: string; pitch: string }

export type VoiceOptions = { voice: string; voices: Voice[] }

export function voiceOptions(): Promise<VoiceOptions> {
  return invoke("voice_settings")
}

/** The voice for the next call; a call that's running keeps its voice. */
export function setVoice(name: string): Promise<void> {
  return invoke("set_voice", { name })
}
