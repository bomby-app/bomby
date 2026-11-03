import { invoke } from "@tauri-apps/api/core"

// The core's view of the user's own Claude Code (src-tauri/src/claude.rs).

export type ClaudeStatus = {
  /** Where `claude` is, or null when it can't be found. */
  path: string | null
  version: string | null
  signedIn: boolean
  /** The account's plan, e.g. "max" or "pro". */
  plan: string | null
}

export function claudeStatus(): Promise<ClaudeStatus> {
  return invoke("claude_status")
}

/** "max" -> "Claude Max". */
export function planName(plan: string): string {
  return `Claude ${plan.charAt(0).toUpperCase()}${plan.slice(1)}`
}
