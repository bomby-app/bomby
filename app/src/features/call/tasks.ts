import { useAgent, useSessionContext } from "@livekit/components-react"
import { useMemo } from "react"

/** What the voice agent publishes as `bomby.tasks` (agent/task_board.py). */
export type Task = {
  id: string
  agent: string
  agentName: string
  session: string
  task: string
  status: "queued" | "working" | "added" | "done" | "failed" | "stopped"
  startedAt: number
  endedAt: number | null
}

const ATTRIBUTE = "bomby.tasks"

/** The call's tasks, newest first, from the agent participant's attributes. */
export function useTasks(): Task[] {
  const session = useSessionContext()
  const { attributes } = useAgent(session)
  const raw = attributes[ATTRIBUTE]
  return useMemo(() => {
    if (!raw) return []
    try {
      return (JSON.parse(raw) as Task[]).slice().reverse()
    } catch {
      return []
    }
  }, [raw])
}
