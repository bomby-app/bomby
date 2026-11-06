import { onKeysChanged } from "@/features/call-server/api"
import { createStore, useStore } from "@/lib/store"

import { type VoiceSettings, voiceSettings } from "./api"

type Saved = {
  /** null until the core first answers. */
  settings: VoiceSettings | null
  error: string | null
}

/**
 * Who Bomby talks through, each provider's key (whether one is saved), voice and options,
 * shared by the page (Settings, Voice and the splash). Read once, then again whenever any
 * window saves a key or picks a provider (keys-changed), and after each change here.
 */
const store = createStore<Saved>({ settings: null, error: null }, () => {
  void onKeysChanged(() => void readVoiceSettings())
  void readVoiceSettings()
})

export function useVoiceSettings(): Saved {
  return useStore(store)
}

/** Never rejects: a failure shows as the store's error, with the last answer kept. */
export async function readVoiceSettings(): Promise<void> {
  try {
    store.set({ settings: await voiceSettings(), error: null })
  } catch (e) {
    store.set({ ...store.get(), error: String(e) })
  }
}

/** Runs one change, then reads what the core has; never rejects. */
export async function changeVoice(write: () => Promise<void>): Promise<void> {
  try {
    await write()
  } catch (e) {
    store.set({ ...store.get(), error: String(e) })
    return
  }
  await readVoiceSettings()
}
