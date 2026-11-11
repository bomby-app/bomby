import { onKeysChanged } from "@/features/call-server/api"
import { createStore, useStore } from "@/lib/store"

import { agentKeys } from "./api"

/**
 * Which of each agent's keys are saved, for this page: the variables' names only, never a
 * key (the core keeps them; src-tauri/src/credentials.rs). Read from the core once, then
 * again whenever any window saves or removes a key (keys-changed).
 */
type AgentKeys = {
  /** By agent id; null until the core first answers. */
  saved: Partial<Record<string, string[]>> | null
  error: string | null
}

// Reads overlap (keys-changed from every window): only the latest lands.
let reads = 0

async function readAgain(): Promise<void> {
  const read = ++reads
  try {
    const saved = await agentKeys()
    if (read === reads) store.set({ saved, error: null })
  } catch (e) {
    if (read === reads) store.set({ ...store.get(), error: String(e) })
  }
}

const store = createStore<AgentKeys>(
  { saved: null, error: null },
  () => {
    void onKeysChanged(() => void readAgain())
    void readAgain()
  },
  () => {
    if (store.get().error !== null) void readAgain()
  }
)

/**
 * The variables with a key saved for `agent`, kept current, and whether that's known yet:
 * until the core first answers, nothing is, and a field can't say whether it's saved.
 */
export function useSavedAgentKeys(agent: string): {
  saved: string[]
  known: boolean
} {
  const { saved } = useStore(store)
  return { saved: saved?.[agent] ?? [], known: saved !== null }
}

/**
 * Why the saved keys couldn't be read, for the whole Agents section (it's about every
 * agent's keys, not one's). Saving still works: the core keeps what it's given.
 */
export function useAgentKeysError(): string | null {
  return useStore(store).error
}
