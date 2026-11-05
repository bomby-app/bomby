import { createStore, useStore } from "@/lib/store"

import {
  type AgentStatus,
  agentsStatus,
  onAgentsChanged,
  refreshAgents,
  type Step,
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

/** Installed and not found to need setup. One the core couldn't probe counts as ready. */
export function isReady(agent: AgentStatus): boolean {
  return setupStep(agent) === "ready"
}

/**
 * What an agent needs before a call can use it, the same for every agent: installing (none
 * on this Mac), or the step the core's probe decided (`Step`): its ACP adapter (`connect`,
 * which Set up installs), what its own setup lacks (`sign_in`: the agent's fix, in
 * Terminal), a model pick for an agent whose harness requires one (`pick`, in
 * `ModelPicker`), or an answer (`unreachable`: check again). Any other agent's model can be
 * changed there, but never has to be.
 */
export type SetupStep = "missing" | Step

export function setupStep({ path, setup }: AgentStatus): SetupStep {
  if (path === null) return "missing"
  return setup?.step ?? "ready"
}
