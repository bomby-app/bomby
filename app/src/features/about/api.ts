import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

import type { About, DiagnosticsExport, UpdateStatus } from "@/generated/about"

// The core's version and updates (src-tauri/src/updates.rs, docs/releasing.md), and
// Export Diagnostics (src-tauri/src/diagnostics.rs).

export type { About, DiagnosticsExport, UpdateStatus } from "@/generated/about"

export function about(): Promise<About> {
  return invoke("about")
}

/** Checks for an update now. Never rejects: a failure is the `failed` status. */
export function checkForUpdates(): Promise<UpdateStatus> {
  return invoke("check_for_updates")
}

/**
 * Downloads and installs the update a check found, then restarts Bomby. Rejects with a
 * message for the user, such as while a call is on.
 */
export function installUpdate(): Promise<void> {
  return invoke("install_update")
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
 * the user.
 */
export function exportDiagnostics(): Promise<DiagnosticsExport> {
  return invoke("export_diagnostics")
}

/** Shows the last exported zip in Finder again. Rejects with a message for the user. */
export function showDiagnostics(): Promise<void> {
  return invoke("show_diagnostics")
}
