import { createStore, useStore } from "@/lib/store"

import {
  credentialsInfo,
  hasGeminiKey,
  type LiveKitServer,
  livekitServer,
  onKeysChanged,
  setLivekitServer,
} from "./api"

/**
 * Which keys are saved, for this page: only whether each exists, never a key itself (the
 * core keeps them; src-tauri/src/credentials.rs). Read from the core once, then again
 * whenever any window saves or removes one (keys-changed) and on Check again. Every
 * component shares it, so a section that opens again shows it at once.
 */
export type Keys = {
  server: LiveKitServer
  /** Ready for a call: this Mac's, or their keys saved. */
  livekit: boolean
  theirLiveKit: boolean
  gemini: boolean
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
    const [server, theirs, gemini] = await Promise.all([
      livekitServer(),
      credentialsInfo(),
      hasGeminiKey(),
    ])
    const theirLiveKit = !!theirs?.hasSecret
    store.set({
      keys: {
        server,
        livekit: server === "thisMac" || theirLiveKit,
        theirLiveKit,
        gemini,
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
