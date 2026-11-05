import { createStore, useStore } from "@/lib/store"

import { about, type About, onUpdateStatus } from "./api"

/**
 * The version and the update status, for this page: read from the core once, then kept
 * current by its update-status events, so About and its sidebar mark agree.
 */
const store = createStore<About | null>(null, () => {
  void onUpdateStatus((status) => {
    const current = store.get()
    if (current) store.set({ ...current, status })
  })
  void about().then((answer) => store.set(answer))
})

/** null until the core first answers. */
export function useAbout(): About | null {
  return useStore(store)
}
