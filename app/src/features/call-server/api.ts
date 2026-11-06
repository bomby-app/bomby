import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

import type {
  CredentialsInfo,
  CredentialsInput,
  LiveKitServer,
} from "@/generated/credentials"

// The core's credentials commands (src-tauri/src/credentials.rs), for the settings window
// and the first-run splash (capabilities/). The API secret goes in, never comes back out.

export type {
  CredentialsInfo,
  CredentialsInput,
  LiveKitServer,
} from "@/generated/credentials"

export function credentialsInfo(): Promise<CredentialsInfo | null> {
  return invoke("credentials_info")
}

export function saveCredentials(input: CredentialsInput): Promise<void> {
  return invoke("save_credentials", { input })
}

export function clearCredentials(): Promise<void> {
  return invoke("clear_credentials")
}

export function livekitServer(): Promise<LiveKitServer> {
  return invoke("livekit_server")
}

/** Applies from the next call; every window hears keys-changed. */
export function setLivekitServer(server: LiveKitServer): Promise<void> {
  return invoke("set_livekit_server", { server })
}

/** Calls `handler` when a key or the LiveKit server changes, in any window. */
export function onKeysChanged(handler: () => void): Promise<UnlistenFn> {
  return listen("keys-changed", () => handler())
}
