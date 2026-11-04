import { createStore, useStore } from "@/lib/store"

import { installAdapters } from "./api"

/**
 * The adapter install, shared by every Set up button on the page: one runs at a time, and
 * each button shows its progress. The core rechecks the agents when it's done, and the
 * new list arrives as agents-changed.
 */
type Install = { installing: boolean; error: string | null }

const store = createStore<Install>({ installing: false, error: null })

export function useAdapterInstall(): Install {
  return useStore(store)
}

/** Installs the adapters. Never rejects: a failure shows as the store's error. */
export async function installAdaptersNow(): Promise<void> {
  if (store.get().installing) return
  store.set({ installing: true, error: null })
  try {
    await installAdapters()
    store.set({ installing: false, error: null })
  } catch (e) {
    store.set({ installing: false, error: String(e) })
  }
}
