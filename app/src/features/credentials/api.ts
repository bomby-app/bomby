import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

import type { CredentialsInfo, CredentialsInput } from "@/generated/credentials"

// The core's credentials commands (src-tauri/src/credentials.rs), for the settings window
// and the first-run splash (capabilities/). The API secret goes in, never comes back out.

export type { CredentialsInfo, CredentialsInput } from "@/generated/credentials"

export function credentialsInfo(): Promise<CredentialsInfo | null> {
  return invoke("credentials_info")
}

export function saveCredentials(input: CredentialsInput): Promise<void> {
  return invoke("save_credentials", { input })
}

export function clearCredentials(): Promise<void> {
  return invoke("clear_credentials")
}

/** Whether a Gemini API key is saved (the key stays in the core). */
export function hasGeminiKey(): Promise<boolean> {
  return invoke("has_gemini_key")
}

export function saveGeminiKey(key: string): Promise<void> {
  return invoke("save_gemini_key", { key })
}

export function clearGeminiKey(): Promise<void> {
  return invoke("clear_gemini_key")
}

/** Calls `handler` whenever a key is saved or removed, in any window. */
export function onKeysChanged(handler: () => void): Promise<UnlistenFn> {
  return listen("keys-changed", () => handler())
}
