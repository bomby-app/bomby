import { createStore, useStore } from "@/lib/store"

import {
  type ExtensionSetting,
  extensionsSettings,
  onExtensionsChanged,
  type ProjectExtensions,
} from "./api"

// Reads overlap (one per change, from every window): only the latest lands.
let reads = 0

/**
 * Every extension with whether Settings has it on, for this page: read from the core once,
 * then again whenever a window turns one on or off. null until the core first answers, or
 * if it can't.
 */
const store = createStore<ExtensionSetting[] | null>(null, () => {
  const read = () => {
    const mine = ++reads
    return extensionsSettings().then(
      (settings) => {
        if (mine === reads) store.set(settings)
      },
      () => {
        // Without the list, the page shows no extension; the next change reads again.
      }
    )
  }
  void onExtensionsChanged(() => void read()).then(read)
})

export function useExtensions(): ExtensionSetting[] | null {
  return useStore(store)
}

/** Puts the core's answer in the store, so this page shows it before the event lands. */
export function setExtensions(settings: ExtensionSetting[]) {
  // A read still on its way predates this answer.
  reads++
  store.set(settings)
}

/** Whether a project's calls have the extension `id`: its own choice, or Settings'. */
export function isOn(
  id: string,
  project: ProjectExtensions,
  settings: ExtensionSetting[] | null
): boolean {
  if (project.own) return project.on?.includes(id) ?? false
  return settings?.find((e) => e.id === id)?.on ?? false
}
