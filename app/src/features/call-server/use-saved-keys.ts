import {
  setVoiceProvider,
  type VoiceProvider,
  voiceSettings,
} from "@/features/voice/api"
import { createStore, useStore } from "@/lib/store"

import {
  credentialsInfo,
  type LiveKitServer,
  livekitServer,
  onKeysChanged,
  setLivekitServer,
} from "./api"

/**
 * Which keys are saved, for this page: only whether each exists, never a key itself (the
 * core keeps them; src-tauri/src/credentials.rs), and who Bomby talks through. Read from the core once, then again
 * whenever any window saves or removes one (keys-changed) and on Check again. Every
 * component shares it, so a section that opens again shows it at once.
 */
export type Keys = {
  server: LiveKitServer
  /** Ready for a call: this Mac's, or their keys saved. */
  livekit: boolean
  theirLiveKit: boolean
  /** Who Bomby talks through; null until the user picks one. */
  voice: VoiceProvider | null
  /** Which providers' keys are saved. */
  voiceKeys: Record<VoiceProvider, boolean>
  /** The picked provider's key is saved. */
  voiceKey: boolean
}

type SavedKeys = {
  /** null until the core first answers. */
  keys: Keys | null
  error: string | null
}

const store = createStore<SavedKeys>({ keys: null, error: null }, () => {
  void onKeysChanged(() => void checkKeysAgain())
  void checkKeysAgain()
})

/** The LiveKit server calls use, and which keys are saved. */
export function useSavedKeys(): SavedKeys {
  return useStore(store)
}

/**
 * Reads again which keys are saved. Never rejects: a failure shows as the store's error,
 * with the last answer kept.
 */
export async function checkKeysAgain(): Promise<void> {
  try {
    const [server, theirs, voices] = await Promise.all([
      livekitServer(),
      credentialsInfo(),
      voiceSettings(),
    ])
    const theirLiveKit = !!theirs?.hasSecret
    const voice = voices.provider
    const voiceKeys = Object.fromEntries(
      voices.providers.map((p) => [p.provider, p.hasKey])
    ) as Record<VoiceProvider, boolean>
    store.set({
      keys: {
        server,
        livekit: server === "thisMac" || theirLiveKit,
        theirLiveKit,
        voice,
        voiceKeys,
        voiceKey: voice !== null && voiceKeys[voice],
      },
      error: null,
    })
  } catch (e) {
    store.set({ ...store.get(), error: String(e) })
  }
}

/** Never rejects, like `checkKeysAgain`. */
export async function chooseLiveKitServer(
  server: LiveKitServer
): Promise<void> {
  try {
    await setLivekitServer(server)
  } catch (e) {
    store.set({ ...store.get(), error: String(e) })
    return
  }
  await checkKeysAgain()
}

/** Never rejects, like `checkKeysAgain`. */
export async function chooseVoiceProvider(
  provider: VoiceProvider
): Promise<void> {
  try {
    await setVoiceProvider(provider)
  } catch (e) {
    store.set({ ...store.get(), error: String(e) })
    return
  }
  await checkKeysAgain()
}
