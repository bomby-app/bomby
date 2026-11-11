import { call } from "@/lib/core"

// The first run (src-tauri/src/settings.rs): the splash shows until the user finishes it.

/**
 * How long the main window waits for its first read of the core before it says the core
 * isn't answering: a quick read of one setting, so a longer wait means it's stuck.
 */
export const FIRST_READ = 8_000

export function firstRun(): Promise<boolean> {
  return call("first_run", undefined, { timeout: FIRST_READ })
}

export function finishFirstRun(): Promise<void> {
  return call("finish_first_run")
}
