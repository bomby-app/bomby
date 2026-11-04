import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

// The core's view of the agents on this computer (src-tauri/src/agents.rs).

export type AgentStatus = {
  /** The harness id the voice agent uses: "claude", "opencode", "omp". */
  id: string
  name: string
  /** Where its program is, or null when it isn't installed. */
  path: string | null
  version: string | null
  /** Null until the core has probed this program and version, or when it can't. */
  setup: Setup | null
}

/** Whether an installed agent is set up, from its own answers over ACP. */
export type Setup = {
  ready: boolean
  /** What's wrong, in the agent's words where it gave any. */
  problem: string | null
  /** What to run in Terminal to fix it, e.g. "goose configure". */
  fix: string | null
  /** Who it runs as: "Claude Max". */
  account: string | null
  model: string | null
}

/** What the core found last: instant, except right after launch while it first looks. */
export function agentsStatus(): Promise<AgentStatus[]> {
  return invoke("agents_status")
}

/**
 * Asks the core to look again; resolves with what it found. `recheck` probes every
 * installed agent's setup again, not only the ones that changed.
 */
export function refreshAgents(recheck: boolean): Promise<AgentStatus[]> {
  return invoke("refresh_agents", { recheck })
}

/** Calls `handler` with the new list whenever a look finds something different. */
export function onAgentsChanged(
  handler: (agents: AgentStatus[]) => void
): Promise<UnlistenFn> {
  return listen<AgentStatus[]>("agents-changed", (event) =>
    handler(event.payload)
  )
}

/** The bare version number from whatever `--version` printed ("omp/18.16.0" -> "18.16.0"). */
export function versionNumber(version: string): string {
  return version.match(/\d+(\.\d+)+/)?.[0] ?? version
}
