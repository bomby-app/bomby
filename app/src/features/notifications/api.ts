import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"

// The core's notifications (src-tauri/src/notifications.rs).

export type FinishedTask = {
  projectId: number
  agentName: string
  session: string
  status: "done" | "failed"
  task: string
}

/** A task ended; the core notifies when no Bomby window is focused. */
export function taskFinished(task: FinishedTask): Promise<void> {
  return invoke("task_finished", { task })
}

/** A notification was clicked: show its project. Returns the unlisten. */
export function onOpenProject(handler: (projectId: number) => void) {
  return getCurrentWindow().listen<number>("open-project", (event) =>
    handler(event.payload)
  )
}
