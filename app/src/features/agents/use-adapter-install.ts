import { useSyncExternalStore } from "react"

import { type InstallStep, installAdapters, onInstallProgress } from "./api"

/**
 * The adapter install, shared by every Set up button on the page: one runs at a time, and
 * each button shows its progress. The core rechecks the agents when it's done, and the
 * new list arrives as agents-changed.
 */
type Install = { step: InstallStep | "starting" | null; error: string | null }

let snapshot: Install = { step: null, error: null }
const listeners = new Set<() => void>()
let following = false

function set(next: Install) {
  snapshot = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  if (!following) {
    following = true
    void onInstallProgress((step) => {
      if (snapshot.step !== null) set({ step, error: null })
    })
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useAdapterInstall(): Install {
  return useSyncExternalStore(subscribe, () => snapshot)
}

/** Installs the adapters. Never rejects: a failure shows as the store's error. */
export async function installAdaptersNow(): Promise<void> {
  if (snapshot.step !== null) return
  set({ step: "starting", error: null })
  try {
    await installAdapters()
    set({ step: null, error: null })
  } catch (e) {
    set({ step: null, error: String(e) })
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
