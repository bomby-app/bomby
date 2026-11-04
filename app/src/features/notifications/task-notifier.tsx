import { useEffect, useEffectEvent, useRef } from "react"

import { useCall } from "@/features/call/call-provider"
import { type Task, useTasks } from "@/features/call/tasks"

import { onOpenProject, taskFinished } from "./api"

/**
 * Tells the core when one of the call's tasks finishes or fails, so it can notify a user
 * who's away from Bomby ("Claude's done · fix-login"), and shows the project when that
 * notification is clicked. Only a task seen running counts: tasks that were already over
 * when the page loaded, cancelled ones and ones that joined a running turn (`added`) don't.
 * Renders nothing; lives inside the call's session, in the main window.
 */
export function TaskNotifier({
  onOpen,
}: {
  onOpen: (projectId: number) => void
}) {
  const { active } = useCall()
  const tasks = useTasks()
  // The current session's tasks and their last status (ids restart with every session).
  const seen = useRef<{ session: number; status: Map<string, Task["status"]> }>(
    { session: 0, status: new Map() }
  )

  useEffect(() => {
    if (!active) return
    // A new session starts over, so earlier calls' tasks aren't kept.
    if (seen.current.session !== active.startedAt) {
      seen.current = { session: active.startedAt, status: new Map() }
    }
    const before = seen.current.status
    const now = new Map(tasks.map((task) => [task.id, task.status]))
    for (const task of tasks) {
      if (
        before.get(task.id) === "working" &&
        (task.status === "done" || task.status === "failed")
      ) {
        void taskFinished({
          projectId: active.projectId,
          agentName: task.agentName,
          session: task.session,
          status: task.status,
          task: task.task,
        })
      }
    }
    // Only the tasks still listed are kept.
    seen.current.status = now
  }, [tasks, active])

  const open = useEffectEvent((projectId: number) => onOpen(projectId))
  useEffect(() => {
    const stop = onOpenProject((projectId) => open(projectId))
    return () => {
      void stop.then((unlisten) => unlisten())
    }
  }, [])

  return null
}
