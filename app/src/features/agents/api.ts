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
  /** Null when the core couldn't probe it. */
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
  /** The ACP adapter it still needs ("codex-acp"); Set up installs it. */
  adapter: string | null
  /** Picks that didn't apply; sessions keep its default for them. */
  skipped: Skipped[]
  /** Its harness requires a model pick, and none holds: calls wait for one. */
  needsPick: boolean
  /** Whether a session was opened, so `model` and `skipped` are known. */
  session: boolean
}

/** A pick that didn't apply: no longer offered (`gone`), or `refused` by the agent. */
export type Skipped = {
  setting: string
  /** The setting's name, as the agent gives it: "Model". */
  name: string
  value: string
  why: "gone" | "refused"
}

/** What the model picker shows: the setup, and what the user can pick, picks applied. */
export type Listed = Setup & { settings: Setting[] }

/** A session setting the user can pick: a model, an effort, goose's provider. */
export type Setting = {
  id: string
  name: string
  /** ACP's category: "model", "thought_level", or null. */
  category: string | null
  current: string
  options: SettingOption[]
}

export type SettingOption = {
  value: string
  name: string
  /** The heading the agent files it under, if it groups its options. */
  group: string | null
}

/** The value picked for one setting, in the order they're applied. */
export type Choice = { setting: string; value: string }

/** What the core found last: instant, except right after launch while it first looks. */
export function agentsStatus(): Promise<AgentStatus[]> {
  return invoke("agents_status")
}

/** Asks the core to look again, setup included; resolves with what it found. */
export function refreshAgents(): Promise<AgentStatus[]> {
  return invoke("refresh_agents")
}

/** What `agent` lets the user pick, its picks applied, asked of the agent (a few seconds). */
export function agentSettings(agent: string): Promise<Listed> {
  return invoke("agent_settings", { agent })
}

/**
 * Saves `agent`'s picks and resolves with its settings once they're applied: a pick can
 * change what the next one offers (goose's models follow its provider). The agents list
 * follows through `agents-changed`.
 */
export function pickAgentSettings(
  agent: string,
  choices: Choice[]
): Promise<Listed> {
  return invoke("pick_agent_settings", { agent, choices })
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

/** The bare version number from whatever `--version` printed ("omp/18.16.0" -> "18.16.0"). */
export function versionNumber(version: string): string {
  return version.match(/\d+(\.\d+)+/)?.[0] ?? version
}
