import { useAgent, useSessionContext } from "@livekit/components-react"
import { useEffect, useMemo, useState } from "react"

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
/** The agent's RPC for a task's full request (`REQUEST_METHOD` in agent/task_board.py). */
const REQUEST_METHOD = "bomby.tasks.request"

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

/** A task's full request: still being read, read, or the agent couldn't say. */
type TaskRequest =
  | { state: "reading" }
  | { state: "read"; text: string }
  | { state: "failed" }

/**
 * What the agent was asked in `task`, word for word: `bomby.tasks` carries each request
 * shortened, so it's read from the voice agent when the user opens one. It fails when the
 * call has ended or the task is no longer kept.
 */
export function useTaskRequest(task: Task | null): TaskRequest {
  const session = useSessionContext()
  const agent = useAgent(session)
  const identity = "identity" in agent ? agent.identity : undefined
  const [answer, setAnswer] = useState<{
    id: string
    request: TaskRequest
  } | null>(null)

  const id = task?.id
  useEffect(() => {
    if (id === undefined) return
    let current = true
    const settle = (request: TaskRequest) => {
      if (current) setAnswer({ id, request })
    }
    if (!identity) {
      settle({ state: "failed" })
      return
    }
    session.room.localParticipant
      .performRpc({
        destinationIdentity: identity,
        method: REQUEST_METHOD,
        payload: id,
      })
      .then(
        (text) => settle({ state: "read", text }),
        () => settle({ state: "failed" })
      )
    return () => {
      current = false
    }
  }, [session.room, identity, id])

  return answer !== null && answer.id === id
    ? answer.request
    : { state: "reading" }
}
