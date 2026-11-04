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
  // Each task's last status, by session and task id (ids restart with every session).
  const seen = useRef(new Map<string, Task["status"]>())

  useEffect(() => {
    if (!active) return
    for (const task of tasks) {
      const key = `${active.startedAt}:${task.id}`
      const before = seen.current.get(key)
      seen.current.set(key, task.status)
      if (
        before === "working" &&
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
