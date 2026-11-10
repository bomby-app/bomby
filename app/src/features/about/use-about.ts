import { createStore, useStore } from "@/lib/store"

import { about, type About, onUpdateStatus, type UpdateStatus } from "./api"

type AboutState = {
  /** null until the core first answers. */
  info: About | null
  /** Why the version or the update status couldn't be read. */
  error: string | null
}

/**
 * The version and the update status: read from the core once, then kept current by its
 * update-status events, so About and its sidebar mark agree. The listener is in place
 * before the first read, and an event that lands while the read is on its way wins over
 * the read's answer, so a launch check finishing meanwhile is never lost. A failed read
 * is held as the error, for About to show.
 */
export function aboutStore(core: {
  about: () => Promise<About>
  onUpdateStatus: (handler: (status: UpdateStatus) => void) => Promise<unknown>
}) {
  let latest: UpdateStatus | null = null
  const store = createStore<AboutState>({ info: null, error: null }, () => {
    void (async () => {
      try {
        await core.onUpdateStatus((status) => {
          latest = status
          const { info } = store.get()
          if (info) store.set({ info: { ...info, status }, error: null })
        })
        const answer = await core.about()
        store.set({
          info: latest ? { ...answer, status: latest } : answer,
          error: null,
        })
      } catch (e) {
        store.set({ ...store.get(), error: String(e) })
      }
    })()
  })
  return store
}

// This page's one copy, started by its first subscriber.
const store = aboutStore({ about, onUpdateStatus })

export function useAbout(): AboutState {
  return useStore(store)
}
