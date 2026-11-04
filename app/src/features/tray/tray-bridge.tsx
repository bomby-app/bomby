import { useAgent, useSessionContext } from "@livekit/components-react"
import { useEffect, useState } from "react"

import { mascotState } from "@/components/mascot"
import { useCall } from "@/features/call/call-provider"
import { useTasks } from "@/features/call/tasks"
import { useCallReadiness } from "@/features/call/use-call-readiness"
import { useProjects } from "@/features/projects/projects-provider"
import { RECENT_COUNT, recentProjects } from "@/features/projects/recent"
import { useCoreEvent } from "@/hooks/use-core-event"

import { onEndCall, onStartCall, setTrayStatus, type TrayState } from "./api"

/** How long the crossed eyes stay after a call fails. */
const FAILED_MS = 5000

/**
 * Keeps the menu bar icon in step with the call, and runs what its menu asks for: Start a
 * call (opens the project, then starts) and End call. Renders nothing; lives inside the
 * call's session, in the main window.
 */
export function TrayBridge({
  onOpenProject,
}: {
  onOpenProject: (projectId: number) => void
}) {
  const { active, starting, error, start } = useCall()
  const session = useSessionContext()
  const agent = useAgent(session)
  const tasks = useTasks()
  const { projects } = useProjects()
  const { ready, missing } = useCallReadiness()
  const failed = useRecentError(error)

  const working = tasks.some((task) => task.status === "working")
  const state = trayState({
    starting: starting !== null,
    inCall: active !== null,
    agent: agent.state,
    working,
    failed,
  })
  const callProject = active?.projectId ?? starting?.projectId
  const call = projects?.find((p) => p.id === callProject)?.name ?? null
  const recent = recentProjects(projects ?? [])
    .slice(0, RECENT_COUNT)
    .map(({ id, name }) => ({ id, name }))
  const blocked = ready ? null : (missing ?? "Checking your setup...")
  const isStarting = starting !== null

  // The core redraws only what changed.
  useEffect(() => {
    void setTrayStatus({ state, call, starting: isStarting, recent, blocked })
  }, [state, call, isStarting, recent, blocked])

  useCoreEvent(onStartCall, (projectId) => {
    onOpenProject(projectId)
    // One call at a time; when a call can't start, the project's page says why.
    if (ready && !active && !starting) void start(projectId)
  })
  useCoreEvent(onEndCall, () => void session.end())

  return null
}

function trayState({
  starting,
  inCall,
  agent,
  working,
  failed,
}: {
  starting: boolean
  inCall: boolean
  agent: string
  working: boolean
  failed: boolean
}): TrayState {
  if (starting) return "waking"
  if (!inCall) return failed ? "failed" : "idle"
  const mascot = mascotState(agent)
  if (mascot === "asleep") return "idle"
  // Working is a layer under the live state (Paper "04 Mascot states"): it shows while the
  // voice is only listening.
  if (working && (mascot === "listening" || mascot === "idle")) return "working"
  return mascot
}

/** Whether `error` arrived in the last few seconds: the menu bar shows it briefly. */
function useRecentError(error: object | null): boolean {
  const [seen, setSeen] = useState<object | null>(null)
  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => setSeen(error), FAILED_MS)
    return () => window.clearTimeout(timer)
  }, [error])
  return error !== null && error !== seen
}
