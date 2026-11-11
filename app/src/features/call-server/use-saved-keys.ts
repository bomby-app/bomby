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
  readKeysAgain,
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
  /** Who Bomby talks through: the pick, else the first provider with a key, else Gemini. */
  voice: VoiceProvider
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
  // A first read that failed is tried again when the window comes back, so Call doesn't
  // stay disabled until a key changes.
  window.addEventListener("focus", () => {
    const { keys, error } = store.get()
    if (keys === null && error !== null) void checkKeysAgain()
  })
})

/** The LiveKit server calls use, and which keys are saved. */
export function useSavedKeys(): SavedKeys {
  return useStore(store)
}

// Reads overlap (a pick's own, and keys-changed from every window), and only the latest
// may land; a pick still saving shows over what the core has.
let reads = 0
let picking: VoiceProvider | null = null
let picks = 0
let saving: Promise<void> = Promise.resolve()

/**
 * Reads again which keys are saved. Never rejects: a failure shows as the store's error,
 * with the last answer kept.
 */
export async function checkKeysAgain(): Promise<void> {
  const read = ++reads
  try {
    const [server, theirs, voices] = await Promise.all([
      livekitServer(),
      credentialsInfo(),
      voiceSettings(),
    ])
    if (read !== reads) return
    const theirLiveKit = !!theirs?.hasSecret
    const voice = picking ?? voices.provider
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
        voiceKey: voiceKeys[voice],
      },
      error: null,
    })
  } catch (e) {
    if (read === reads) store.set({ ...store.get(), error: String(e) })
  }
}

/**
 * Try again on a keys error: asks the keychain again (the core remembers a read that
 * failed, so nothing else does), then reads which keys are saved. Never rejects, like
 * `checkKeysAgain`.
 */
export async function tryKeysAgain(): Promise<void> {
  try {
    await readKeysAgain()
  } catch (e) {
    store.set({ ...store.get(), error: String(e) })
    return
  }
  await checkKeysAgain()
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

/**
 * Shows the pick at once, then saves it. Picks are saved one after another, and one a newer
 * pick replaces before its turn is skipped, so the last one is what the core keeps. Never
 * rejects, like `checkKeysAgain`.
 */
export async function chooseVoiceProvider(
  provider: VoiceProvider
): Promise<void> {
  const pick = ++picks
  picking = provider
  const { keys } = store.get()
  if (keys)
    store.set({
      ...store.get(),
      keys: { ...keys, voice: provider, voiceKey: keys.voiceKeys[provider] },
    })
  let failed: string | null = null
  saving = saving.then(async () => {
    if (pick !== picks) return
    try {
      await setVoiceProvider(provider)
    } catch (e) {
      failed = String(e)
    }
  })
  await saving
  if (pick !== picks) return
  picking = null
  // Shows what the core kept, and why, when the save failed.
  await checkKeysAgain()
  if (failed !== null) store.set({ ...store.get(), error: failed })
}
