import { onKeysChanged } from "@/features/call-server/api"
import { createStore, useStore } from "@/lib/store"

import {
  type ExtensionSetting,
  extensionsSettings,
  onExtensionsChanged,
  type ProjectExtensions,
} from "./api"

// Reads overlap (one per change, from every window): only the latest lands.
let reads = 0

/** Reads the list again; without it the page shows no extension until a read answers. */
function read(): Promise<void> {
  const mine = ++reads
  return extensionsSettings().then(
    (settings) => {
      if (mine === reads) store.set(settings)
    },
    () => {
      // Read again on the next change, when the keys are read (a sign-in lives with
      // them, so a read waits on macOS's password prompt), or when a screen shows it again.
    }
  )
}

/**
 * Every extension with whether Settings has it on, for this page: read from the core once,
 * then again whenever a window turns one on or off, or the keys change or are first read
 * (whether each is signed in). null until the core first answers, or if it can't.
 */
const store = createStore<ExtensionSetting[] | null>(
  null,
  () => {
    void onExtensionsChanged(() => void read()).then(read)
    void onKeysChanged(() => void read())
  },
  () => {
    if (store.get() === null) void read()
  }
)

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
