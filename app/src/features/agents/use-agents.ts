import { useCallback, useEffect, useState } from "react"

import {
  type AgentStatus,
  agentsStatus,
  onAgentsChanged,
  refreshAgents,
} from "./api"

// One quiet look per page load (the settings window is a new page each time it opens), so
// an agent installed while the app ran shows up without anyone pressing Check again.
let lookedOnOpen = false

/**
 * The agents on this computer as the core last found them, kept current: the list shows at
 * once, and changes arrive by event. `refresh` looks again; the list stays up meanwhile.
 */
export function useAgents() {
  const [agents, setAgents] = useState<AgentStatus[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const unlisten = onAgentsChanged((found) => {
      if (live) setAgents(found)
    })
    agentsStatus().then(
      (found) => {
        if (live) setAgents((current) => current ?? found)
      },
      (e: unknown) => {
        if (live) setError(String(e))
      }
    )
    if (!lookedOnOpen) {
      lookedOnOpen = true
      // What it finds arrives as agents-changed; a failure leaves the list as it was.
      refreshAgents().catch(() => {})
    }
    return () => {
      live = false
      void unlisten.then((stop) => stop())
    }
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      setAgents(await refreshAgents())
    } catch (e) {
      setError(String(e))
    } finally {
      setRefreshing(false)
    }
  }, [])

  return { agents, error, refreshing, refresh }
}

/** Installed, and signed in where the agent can tell us. */
export function isReady({ path, signIn }: AgentStatus): boolean {
  return path !== null && (signIn === null || signIn.signedIn)
}
