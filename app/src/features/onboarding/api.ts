import { invoke } from "@tauri-apps/api/core"

// The first run (src-tauri/src/settings.rs): the splash shows until the user finishes it.

export function firstRun(): Promise<boolean> {
  return invoke("first_run")
}

export function finishFirstRun(): Promise<void> {
  return invoke("finish_first_run")
}
