import { useSyncExternalStore } from "react"

import {
  type AgentStatus,
  agentsStatus,
  onAgentsChanged,
  refreshAgents,
} from "./api"

/**
 * The agents as the core last found them, for this page. The core is the source of truth
 * (src-tauri/src/agents.rs); this mirrors it: it reads the core's list once, then follows
 * its `agents-changed` events. Every component shares one subscription.
 */
type Agents = {
  /** null until the core first answers. */
  agents: AgentStatus[] | null
  error: string | null
}

let snapshot: Agents = { agents: null, error: null }
const listeners = new Set<() => void>()
let started = false

function set(next: Agents) {
  snapshot = next
  for (const listener of listeners) listener()
}

/** Starts mirroring the core, on the first subscriber. */
function start() {
  if (started) return
  started = true
  void onAgentsChanged((agents) => set({ agents, error: null }))
  agentsStatus().then(
    // An event may have brought a newer list already.
    (agents) => set({ agents: snapshot.agents ?? agents, error: null }),
    (e: unknown) => set({ ...snapshot, error: String(e) })
  )
  // One quiet look per page load (Settings is a new page each time it opens), so an agent
  // installed while the app ran shows up unasked. Its result arrives as agents-changed.
  refreshAgents().catch(() => {})
}

function subscribe(listener: () => void) {
  start()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return snapshot
}

/** The agents on this computer, kept current; re-renders when they change. */
export function useAgents(): Agents {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * Asks the core to look again (Check again). Resolves when it has, and never rejects: a
 * failure shows as the store's error, with the last list kept.
 */
export async function checkAgentsAgain(): Promise<void> {
  try {
    set({ agents: await refreshAgents(), error: null })
  } catch (e) {
    set({ ...snapshot, error: String(e) })
  }
}

/** Installed, and signed in where the agent can tell us. */
export function isReady({ path, signIn }: AgentStatus): boolean {
  return path !== null && (signIn === null || signIn.signedIn)
}
