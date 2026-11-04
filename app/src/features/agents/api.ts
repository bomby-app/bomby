import { invoke } from "@tauri-apps/api/core"

// The core's view of the agents on this computer (src-tauri/src/agents.rs).

export type AgentStatus = {
  /** The harness id the voice agent uses: "claude", "opencode", "omp". */
  id: string
  name: string
  /** Where its program is, or null when it isn't installed. */
  path: string | null
  version: string | null
  /** Null when the agent can't report whether it is signed in. */
  signIn: {
    signedIn: boolean
    /** What to run in Terminal to sign in, e.g. "claude auth login". */
    login: string
    plan: string | null
  } | null
}

export function agentsStatus(): Promise<AgentStatus[]> {
  return invoke("agents_status")
}

/** The bare version number from whatever `--version` printed ("omp/18.16.0" -> "18.16.0"). */
export function versionNumber(version: string): string {
  return version.match(/\d+(\.\d+)+/)?.[0] ?? version
}

/** "max" -> "Claude Max". */
export function planName(plan: string): string {
  return `Claude ${plan.charAt(0).toUpperCase()}${plan.slice(1)}`
}
