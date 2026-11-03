import { invoke } from "@tauri-apps/api/core"

// The core's credentials commands (src-tauri/src/credentials.rs). Only the settings window
// may call them (capabilities/settings.json). The API secret goes in, never comes back out.

/** What is saved, without the secret. */
export type CredentialsInfo = {
  url: string
  apiKey: string
  hasSecret: boolean
}

export type CredentialsInput = {
  url: string
  apiKey: string
  /** Omit to keep the saved secret. */
  apiSecret?: string
}

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
