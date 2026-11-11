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
const store = createStore<Saved>(
  { settings: null, error: null },
  () => {
    void onKeysChanged(() => void readVoiceSettings())
    void readVoiceSettings()
  },
  () => {
    if (store.get().error !== null) void readVoiceSettings()
  }
)

export function useVoiceSettings(): Saved {
  return useStore(store)
}

// Reads overlap (a change's own, and keys-changed from every window): only the latest lands.
let reads = 0
// Changes are saved one after another, in click order, so the last one is what's kept.
let changes: Promise<void> = Promise.resolve()

/** Never rejects: a failure shows as the store's error, with the last answer kept. */
async function readVoiceSettings(): Promise<void> {
  const read = ++reads
  try {
    const settings = await voiceSettings()
    if (read === reads) store.set({ settings, error: null })
  } catch (e) {
    if (read === reads) store.set({ ...store.get(), error: String(e) })
  }
}

/** Runs one change after the ones before it, then reads what the core has; never rejects. */
export async function changeVoice(write: () => Promise<void>): Promise<void> {
  let failed: string | null = null
  changes = changes.then(async () => {
    try {
      await write()
    } catch (e) {
      failed = String(e)
    }
  })
  await changes
  if (failed !== null) {
    store.set({ ...store.get(), error: failed })
    return
  }
  await readVoiceSettings()
}
