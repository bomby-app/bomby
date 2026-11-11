import { listen, type UnlistenFn } from "@tauri-apps/api/event"

import type { About, DiagnosticsExport, UpdateStatus } from "@/generated/about"
import { call } from "@/lib/core"

// The core's version and updates (src-tauri/src/updates.rs, docs/releasing.md), and
// Export Diagnostics (src-tauri/src/diagnostics.rs).

export type { About, DiagnosticsExport, UpdateStatus } from "@/generated/about"

export function about(): Promise<About> {
  return call("about")
}

/**
 * Checks for an update now. A failed check is the `failed` status; it rejects only when the
 * core doesn't answer.
 */
export function checkForUpdates(): Promise<UpdateStatus> {
  return call("check_for_updates", undefined, { timeout: 60_000 })
}

/**
 * Downloads and installs the update a check found, then restarts Bomby. Rejects with a
 * message for the user, such as while a call is on.
 */
export function installUpdate(): Promise<void> {
  return call("install_update", undefined, { timeout: null })
}

/** The update status changed, in any window. Returns the unlisten. */
export function onUpdateStatus(
  handler: (status: UpdateStatus) => void
): Promise<UnlistenFn> {
  return listen<UpdateStatus>("update-status", (event) =>
    handler(event.payload)
  )
}

/**
 * Collects Bomby's logs and a short summary, keys and tokens taken out, into one zip on the
 * Desktop and shows it in Finder (src-tauri/src/diagnostics.rs). Rejects with a message for
 * the user when nothing was saved; a zip saved that Finder couldn't show resolves, with
 * `finderError` saying what to do.
 */
export function exportDiagnostics(): Promise<DiagnosticsExport> {
  return call("export_diagnostics", undefined, { timeout: 120_000 })
}

/** Shows the last exported zip in Finder again. Rejects with a message for the user. */
export function showDiagnostics(): Promise<void> {
  return call("show_diagnostics")
}
