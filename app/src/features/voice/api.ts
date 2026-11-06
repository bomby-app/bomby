import { invoke } from "@tauri-apps/api/core"

import type {
  OptionValue,
  VoiceProvider,
  VoiceSettings,
} from "@/generated/voice"

// The core's voice commands (src-tauri/src/voice.rs, and the keys in credentials.rs): who
// Bomby talks through, each provider's key, voice and options. A key goes in and never
// comes back out; the page sees only whether one is saved.

export type {
  OptionValue,
  ProviderOption,
  ProviderSettings,
  Voice,
  VoiceProvider,
  VoiceSettings,
} from "@/generated/voice"

export function voiceSettings(): Promise<VoiceSettings> {
  return invoke("voice_settings")
}

/** Applies from the next call; every window hears keys-changed. */
export function setVoiceProvider(provider: VoiceProvider): Promise<void> {
  return invoke("set_voice_provider", { provider })
}

/** The provider's voice for the next call; a call that's running keeps its voice. */
export function setVoice(
  provider: VoiceProvider,
  voice: string
): Promise<void> {
  return invoke("set_voice", { provider, voice })
}

/** A switch's on or off, or a choice's value, for the provider's next call. */
export function setVoiceOption(
  provider: VoiceProvider,
  option: string,
  value: OptionValue
): Promise<void> {
  return invoke("set_voice_option", { provider, option, value })
}

/** Every window hears keys-changed. */
export function saveVoiceKey(
  provider: VoiceProvider,
  key: string
): Promise<void> {
  return invoke("save_voice_key", { provider, key })
}

export function clearVoiceKey(provider: VoiceProvider): Promise<void> {
  return invoke("clear_voice_key", { provider })
}
