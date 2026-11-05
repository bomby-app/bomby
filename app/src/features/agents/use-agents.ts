import { createStore, useStore } from "@/lib/store"

import {
  type AgentStatus,
  agentsStatus,
  type Choice,
  onAgentsChanged,
  refreshAgents,
  saveAgentSetup,
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

// Starts mirroring the core on the first subscriber.
const store = createStore<Agents>({ agents: null, error: null }, () => {
  void onAgentsChanged((agents) => store.set({ agents, error: null }))
  agentsStatus().then(
    // An event may have brought a newer list already.
    (agents) =>
      store.set({ agents: store.get().agents ?? agents, error: null }),
    (e: unknown) => store.set({ ...store.get(), error: String(e) })
  )
})

/** The agents on this computer, kept current; re-renders when they change. */
export function useAgents(): Agents {
  return useStore(store)
}

/**
 * Asks the core to look again (Check again). Resolves when it has, and never rejects: a
 * failure shows as the store's error, with the last list kept.
 */
export async function checkAgentsAgain(): Promise<void> {
  try {
    store.set({ agents: await refreshAgents(), error: null })
  } catch (e) {
    store.set({ ...store.get(), error: String(e) })
  }
}

/** Saves an agent's setup and takes the core's new list. Rejects when the save fails. */
export async function saveSetup(
  agent: string,
  choices: Choice[]
): Promise<void> {
  store.set({ agents: await saveAgentSetup(agent, choices), error: null })
}

/**
 * Installed, set up, and not found to need anything since. One the core couldn't probe
 * counts as ready.
 */
export function isReady({ path, setUp, setup }: AgentStatus): boolean {
  return path !== null && setUp && setup?.ready !== false
}
