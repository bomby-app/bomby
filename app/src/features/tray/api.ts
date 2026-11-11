import { getCurrentWindow } from "@tauri-apps/api/window"

import type { TrayStatus } from "@/generated/tray"
import { call } from "@/lib/core"

// The core's menu bar icon (src-tauri/src/tray.rs).

export type { TrayState, TrayStatus } from "@/generated/tray"

export function setTrayStatus(status: TrayStatus): Promise<void> {
  return call("set_tray_status", { status })
}

/** Start a call was chosen in the menu bar, on this project. Returns the unlisten. */
export function onStartCall(handler: (projectId: number) => void) {
  return getCurrentWindow().listen<number>("tray-start-call", (event) =>
    handler(event.payload)
  )
}

/** End call was chosen in the menu bar. Returns the unlisten. */
export function onEndCall(handler: () => void) {
  return getCurrentWindow().listen("tray-end-call", () => handler())
}
