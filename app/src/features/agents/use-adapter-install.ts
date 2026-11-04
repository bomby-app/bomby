import { createStore, useStore } from "@/lib/store"

import { type InstallStep, installAdapters, onInstallProgress } from "./api"

/**
 * The adapter install, shared by every Set up button on the page: one runs at a time, and
 * each button shows its progress. The core rechecks the agents when it's done, and the
 * new list arrives as agents-changed.
 */
type Install = { step: InstallStep | "starting" | null; error: string | null }

const store = createStore<Install>({ step: null, error: null }, () => {
  void onInstallProgress((step) => {
    if (store.get().step !== null) store.set({ step, error: null })
  })
})

export function useAdapterInstall(): Install {
  return useStore(store)
}

/** Installs the adapters. Never rejects: a failure shows as the store's error. */
export async function installAdaptersNow(): Promise<void> {
  if (store.get().step !== null) return
  store.set({ step: "starting", error: null })
  try {
    await installAdapters()
    store.set({ step: null, error: null })
  } catch (e) {
    store.set({ step: null, error: String(e) })
  }
}

/** What a Set up button says while it works. */
export function installLabel(step: Install["step"]): string {
  switch (step) {
    case "runtime":
      return "Downloading..."
    case "packages":
      return "Installing..."
    case "build":
    case "done":
      return "Finishing..."
    default:
      return "Setting up..."
  }
}
