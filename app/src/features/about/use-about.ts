import { createStore, useStore } from "@/lib/store"

import { about, type About, onUpdateStatus, type UpdateStatus } from "./api"

/**
 * The version and the update status, for this page: read from the core once, then kept
 * current by its update-status events, so About and its sidebar mark agree. The listener
 * is in place before the first read, and an event that lands while the read is on its way
 * wins over the read's answer, so a launch check finishing meanwhile is never lost.
 */
let latest: UpdateStatus | null = null

const store = createStore<About | null>(null, () => {
  void (async () => {
    await onUpdateStatus((status) => {
      latest = status
      const current = store.get()
      if (current) store.set({ ...current, status })
    })
    const answer = await about()
    store.set(latest ? { ...answer, status: latest } : answer)
  })()
})

/** null until the core first answers. */
export function useAbout(): About | null {
  return useStore(store)
}
