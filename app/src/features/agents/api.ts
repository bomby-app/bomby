import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { openUrl } from "@tauri-apps/plugin-opener"

import type { AgentStatus, Listed, SettingPick } from "@/generated/agents"
import { AGENT_PROBE, AGENTS_LOOK, call } from "@/lib/core"

// The core's view of the agents on this computer (src-tauri/src/agents.rs). The types are
// generated from the core's own structs (`just app types`), so the two can't drift apart.

export type {
  AgentStatus,
  KeyField,
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
  return call("agents_status", undefined, { timeout: AGENTS_LOOK })
}

/** Asks the core to look again, setup included; resolves with what it found. */
export function refreshAgents(): Promise<AgentStatus[]> {
  return call("refresh_agents", undefined, { timeout: AGENTS_LOOK })
}

/**
 * What `agent` lets the user pick, its picks applied, asked of the agent (a few seconds).
 * The agents list follows, through `agents-changed`, when the answer changes its row.
 */
export function agentSettings(agent: string): Promise<Listed> {
  return call("agent_settings", { agent }, { timeout: AGENT_PROBE })
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
  return call("pick_agent_settings", { agent, pick }, { timeout: AGENT_PROBE })
}

/** Which variables have a key saved, by agent id: names only, never a key. */
export function agentKeys(): Promise<Partial<Record<string, string[]>>> {
  return call("agent_keys")
}

/**
 * Saves `agent`'s key under `name`, one of its row's key fields. It reaches only that
 * agent; the agent is checked again with it, and its row follows through `agents-changed`.
 * Every window hears keys-changed.
 */
export function saveAgentKey(
  agent: string,
  name: string,
  key: string
): Promise<void> {
  return call("save_agent_key", { agent, name, key })
}

/** Removes `agent`'s key saved under `name`; every window hears keys-changed. */
export function clearAgentKey(agent: string, name: string): Promise<void> {
  return call("clear_agent_key", { agent, name })
}

/** Installs every ACP adapter into the app's folder; resolves once the agents are rechecked. */
export function installAdapters(): Promise<void> {
  return call("install_adapters", undefined, { timeout: null })
}

/** Opens `agent`'s own install page in the browser (allowed in `capabilities/`). */
export function openInstallPage(agent: AgentStatus): Promise<void> {
  return openUrl(agent.installPage)
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
