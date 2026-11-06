import type { AgentStatus } from "@/features/agents/api"
import { isReady, setupStep } from "@/features/agents/use-agents"
import type { Keys } from "@/features/credentials/use-saved-keys"

/** Offered first when installed, ready or not (owner, 2026-11-05). */
const PREFERRED = ["claude", "codex"]

/** What the user chose on the splash. */
export type Choices = {
  /** Another agent, picked from Other supported agents. */
  chosen: string | null
  /** Set up later: on to the keys without an agent. */
  later: boolean
  /** The agent whose model picker is open. */
  pickingFor: string | null
}

export const NO_CHOICES: Choices = {
  chosen: null,
  later: false,
  pickingFor: null,
}

/** Where the splash is, worked out from what the core reports and what the user chose. */
export type SplashStep = {
  /** The agent the agent step offers; null until the core first answers. */
  agent: AgentStatus | null
  agentReady: boolean
  step: "agent" | "keys"
  /** The keys are in, and the agent is ready or left for later: the arrow goes on. */
  ready: boolean
}

/**
 * The splash as a short form, nothing kept along the way: the agent step until its agent
 * is ready (and its model picker closed) or the user sets it up later, then the keys.
 */
export function splashStep(
  agents: AgentStatus[] | null,
  keys: Keys | null,
  { chosen, later, pickingFor }: Choices
): SplashStep {
  const agent = firstAgent(agents, chosen)
  const agentReady = agent !== null && isReady(agent)
  // A picker that goes away open (another agent, a sign-out) holds nothing up.
  const picking =
    agent !== null &&
    pickingFor === agent.id &&
    ["pick", "ready"].includes(setupStep(agent))
  const agentDone = later || (agentReady && !picking)
  const keysReady = keys !== null && keys.livekit && keys.gemini
  return {
    agent,
    agentReady,
    step: agentDone && keys !== null ? "keys" : "agent",
    ready: agentDone && keysReady,
  }
}

/**
 * The agent the splash offers: the one picked, else Claude Code, else Codex, else the first
 * that's ready, else the first installed. With none installed, Claude Code, to install.
 * Null only until the core first answers.
 */
export function firstAgent(
  agents: AgentStatus[] | null,
  chosen: string | null
): AgentStatus | null {
  if (agents === null) return null
  const installed = agents.filter((agent) => agent.path !== null)
  const byId = (id: string | null) => installed.find((agent) => agent.id === id)
  return (
    byId(chosen) ??
    PREFERRED.map(byId).find(Boolean) ??
    installed.find(isReady) ??
    installed[0] ??
    agents.find((agent) => agent.id === PREFERRED[0]) ??
    agents[0] ??
    null
  )
}
