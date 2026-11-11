import type { AgentStatus } from "@/features/agents/api"
import { isReady } from "@/features/agents/use-agents"
import type { Keys } from "@/features/call-server/use-saved-keys"

/** Offered first when installed, ready or not (owner, 2026-11-05). */
const PREFERRED = ["claude", "codex"]

/** What the user chose on the splash. */
export type Choices = {
  /** Another agent, picked from Other supported agents. */
  chosen: string | null
  /** On to the keys: with the round arrow once the agent's ready, or Set up later. */
  onKeys: boolean
}

export const NO_CHOICES: Choices = { chosen: null, onKeys: false }

/** Where the splash is, worked out from what the core reports and what the user chose. */
type SplashStep = {
  /** The agent the agent step offers; null until the core first answers. */
  agent: AgentStatus | null
  agentReady: boolean
  step: "agent" | "keys"
  /** The step is done: the round arrow shows, to the keys or out of the splash. */
  canContinue: boolean
}

/**
 * The splash as a short form, nothing kept along the way: the agent step until the user
 * goes on (the arrow, once its agent is ready, or Set up later), then the keys, done once
 * they're in. Only the user moves it on; a step that's done shows the arrow.
 */
export function splashStep(
  agents: AgentStatus[] | null,
  keys: Keys | null,
  { chosen, onKeys }: Choices
): SplashStep {
  const agent = firstAgent(agents, chosen)
  const agentReady = agent !== null && isReady(agent)
  const keysReady = keys !== null && keys.livekit && keys.voiceKey
  const step = onKeys && keys !== null ? "keys" : "agent"
  return {
    agent,
    agentReady,
    step,
    canContinue: step === "agent" ? agentReady : keysReady,
  }
}

/**
 * The agent the splash offers: the one picked, else Claude Code, else Codex, else the first
 * that's ready, else the first installed. With none installed, Claude Code, to install.
 * Null only until the core first answers.
 */
function firstAgent(
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
