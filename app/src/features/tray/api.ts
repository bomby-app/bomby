import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"

// The core's menu bar icon (src-tauri/src/tray.rs).

/** The mascot's state in the menu bar: one template image each. */
export type TrayState =
  | "idle"
  | "waking"
  | "listening"
  | "thinking"
  | "speaking"
  | "working"
  | "failed"

export type TrayStatus = {
  state: TrayState
  /** The project on a call, while there is one. */
  call: string | null
  /** Projects to start a call on, the newest call first. */
  recent: { id: number; name: string }[]
  /** Why a call can't start yet, if it can't. */
  blocked: string | null
}

export function setTrayStatus(status: TrayStatus): Promise<void> {
  return invoke("set_tray_status", { status })
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
