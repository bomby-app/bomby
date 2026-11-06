import { describe, expect, it } from "vite-plus/test"

import type { AgentStatus, Setup } from "@/features/agents/api"
import type { Keys } from "@/features/credentials/use-saved-keys"

import { type Choices, NO_CHOICES, splashStep } from "./splash-step"

const SETUP: Setup = {
  step: "ready",
  problem: null,
  fix: null,
  account: null,
  model: null,
  adapter: null,
  skipped: [],
  session: true,
}

/** An agent as the core reports it: installed when it has a path. */
function agent(
  id: string,
  state: "missing" | Setup["step"] = "ready"
): AgentStatus {
  return {
    id,
    name: id,
    path: state === "missing" ? null : `/Users/me/.local/bin/${id}`,
    version: null,
    setup: state === "missing" ? null : { ...SETUP, step: state },
    installPage: `https://example.com/${id}`,
  }
}

const NO_KEYS: Keys = {
  server: "thisMac",
  livekit: true,
  theirLiveKit: false,
  gemini: false,
}
const ALL_KEYS: Keys = { ...NO_KEYS, gemini: true }

const none = [agent("claude", "missing"), agent("codex", "missing")]

function step(
  agents: AgentStatus[] | null,
  keys: Keys | null,
  choices: Partial<Choices> = {}
) {
  const { agent, step, canContinue } = splashStep(agents, keys, {
    ...NO_CHOICES,
    ...choices,
  })
  return { agent: agent?.id ?? null, step, canContinue }
}

describe("splashStep", () => {
  it("waits on the agent step until the core answers", () => {
    expect(step(null, ALL_KEYS)).toEqual({
      agent: null,
      step: "agent",
      canContinue: false,
    })
  })

  it("offers Claude Code to install when no agent is on the Mac", () => {
    expect(step(none, NO_KEYS)).toEqual({
      agent: "claude",
      step: "agent",
      canContinue: false,
    })
  })

  it("stays on a ready agent, with the arrow, until the user goes on", () => {
    expect(step([agent("codex")], NO_KEYS)).toEqual({
      agent: "codex",
      step: "agent",
      canContinue: true,
    })
    // Even with the keys in: the user still sees the agent step and moves on.
    expect(step([agent("codex")], ALL_KEYS).step).toBe("agent")
  })

  it("shows the keys once the user goes on, with the arrow once they're in", () => {
    const onKeys = { onKeys: true }
    expect(step([agent("codex")], NO_KEYS, onKeys)).toEqual({
      agent: "codex",
      step: "keys",
      canContinue: false,
    })
    expect(step([agent("codex")], ALL_KEYS, onKeys).canContinue).toBe(true)
  })

  it("waits for the keys to be known before showing them", () => {
    expect(step([agent("codex")], null, { onKeys: true }).step).toBe("agent")
  })

  it("goes on to the keys after Set up later, and back on Set up an agent", () => {
    expect(step(none, ALL_KEYS, { onKeys: true })).toEqual({
      agent: "claude",
      step: "keys",
      canContinue: true,
    })
    expect(step(none, ALL_KEYS, { onKeys: false }).step).toBe("agent")
  })

  it("has no arrow on an agent that isn't ready yet", () => {
    for (const state of ["connect", "sign_in", "pick", "unreachable"] as const)
      expect(step([agent("codex", state)], ALL_KEYS).canContinue).toBe(false)
  })

  it("keeps Claude Code first when it's installed but not signed in", () => {
    const agents = [agent("claude", "sign_in"), agent("codex")]
    expect(step(agents, ALL_KEYS)).toEqual({
      agent: "claude",
      step: "agent",
      canContinue: false,
    })
  })

  it("offers the agent the user chose, if it's installed", () => {
    const agents = [
      agent("claude", "sign_in"),
      agent("codex"),
      agent("goose", "missing"),
    ]
    expect(step(agents, NO_KEYS, { chosen: "codex" }).agent).toBe("codex")
    expect(step(agents, NO_KEYS, { chosen: "goose" }).agent).toBe("claude")
  })

  it("offers the first ready agent when neither Claude Code nor Codex is installed", () => {
    const agents = [
      agent("claude", "missing"),
      agent("codex", "missing"),
      agent("opencode", "pick"),
      agent("goose"),
    ]
    expect(step(agents, NO_KEYS).agent).toBe("goose")
  })
})
