import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

// The core's version and updates (src-tauri/src/updates.rs, docs/releasing.md).

export type UpdateStatus =
  | { kind: "development" }
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string; percent: number | null }
  | { kind: "restarting" }
  | { kind: "failed"; message: string }

export type About = {
  /** The app's version, which a release's tag must match. */
  version: string
  status: UpdateStatus
}

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
