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
 * What a call talks through, for this page: which LiveKit server, and only whether each key
 * exists, never a key itself (the core keeps them; src-tauri/src/credentials.rs). Read from
 * the core once, then again whenever any window saves or removes one or changes the server
 * (keys-changed) and on Check again. Every component shares it, so a section that opens
 * again shows it at once.
 */
export type Keys = {
  /** Where calls' LiveKit server runs. */
  server: LiveKitServer
  /** Whether a call has its LiveKit: on this Mac, or with the user's keys saved. */
  livekit: boolean
  /** Whether the user's own LiveKit keys (with their secret) are saved. */
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
 * Reads again which keys are saved and which server calls use. Never rejects: a failure
 * shows as the store's error, with the last answer kept.
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

/**
 * Has calls use `server` from the next one on, and shows it at once. Never rejects, like
 * `checkKeysAgain`.
 */
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
