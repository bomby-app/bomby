import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

import type { AgentStatus, Listed, SettingPick } from "@/generated/agents"

// The core's view of the agents on this computer (src-tauri/src/agents.rs). The types are
// generated from the core's own structs (`just app types`), so the two can't drift apart.

export type {
  AgentStatus,
  Listed,
  Setting,
  SettingOption,
  SettingPick,
  Setup,
  Skipped,
  Step,
} from "@/generated/agents"

/** What the core found last: instant, except right after launch while it first looks. */
export function agentsStatus(): Promise<AgentStatus[]> {
  return invoke("agents_status")
}

/** Asks the core to look again, setup included; resolves with what it found. */
export function refreshAgents(): Promise<AgentStatus[]> {
  return invoke("refresh_agents")
}

/**
 * What `agent` lets the user pick, its picks applied, asked of the agent (a few seconds).
 * The agents list follows, through `agents-changed`, when the answer changes its row.
 */
export function agentSettings(agent: string): Promise<Listed> {
  return invoke("agent_settings", { agent })
}

/**
 * Adds `pick` to `agent`'s saved picks and resolves with its settings once they're applied:
 * a pick can change what the next one offers (goose's models follow its provider). Settings
 * never picked keep the agent's own defaults. Rejects, with the saved picks unchanged, when
 * the agent doesn't take it. The agents list follows through `agents-changed`.
 */
export function pickAgentSettings(
  agent: string,
  pick: SettingPick
): Promise<Listed> {
  return invoke("pick_agent_settings", { agent, pick })
}

/** Installs every ACP adapter into the app's folder; resolves once the agents are rechecked. */
export function installAdapters(): Promise<void> {
  return invoke("install_adapters")
}

/** Calls `handler` with the new list whenever a look finds something different. */
export function onAgentsChanged(
  handler: (agents: AgentStatus[]) => void
): Promise<UnlistenFn> {
  return listen<AgentStatus[]>("agents-changed", (event) =>
    handler(event.payload)
  )
}

/** `text` as a sentence: with a full stop, unless it already ends in one (or ? or !). */
export function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`
}

/** The bare version number from whatever `--version` printed ("omp/18.16.0" -> "18.16.0"). */
export function versionNumber(version: string): string {
  return version.match(/\d+(\.\d+)+/)?.[0] ?? version
}
