import { useSyncExternalStore } from "react"

import { credentialsInfo, hasGeminiKey } from "./api"

/**
 * Which keys are saved, for this page: only whether each exists, never a key itself (the
 * core keeps them; src-tauri/src/credentials.rs). Read from the core once, then again after
 * a save, a removal or Check again. Every component shares it, so a section that opens
 * again shows it at once.
 */
type SavedKeys = {
  /** null until the core first answers. */
  keys: { livekit: boolean; gemini: boolean } | null
  error: string | null
}

let snapshot: SavedKeys = { keys: null, error: null }
const listeners = new Set<() => void>()
let started = false

function set(next: SavedKeys) {
  snapshot = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  if (!started) {
    started = true
    void checkKeysAgain()
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return snapshot
}

/** Whether the LiveKit keys (with their secret) and the Gemini key are saved. */
export function useSavedKeys(): SavedKeys {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * Reads again which keys are saved. Never rejects: a failure shows as the store's error,
 * with the last answer kept.
 */
export async function checkKeysAgain(): Promise<void> {
  try {
    const [livekit, gemini] = await Promise.all([
      credentialsInfo(),
      hasGeminiKey(),
    ])
    set({ keys: { livekit: !!livekit?.hasSecret, gemini }, error: null })
  } catch (e) {
    set({ ...snapshot, error: String(e) })
  }
}
