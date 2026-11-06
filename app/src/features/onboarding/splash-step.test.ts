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
  const { agent, step, ready } = splashStep(agents, keys, {
    ...NO_CHOICES,
    ...choices,
  })
  return { agent: agent?.id ?? null, step, ready }
}

describe("splashStep", () => {
  it("waits on the agent step until the core answers", () => {
    expect(step(null, ALL_KEYS)).toEqual({
      agent: null,
      step: "agent",
      ready: false,
    })
  })

  it("offers Claude Code to install when no agent is on the Mac", () => {
    expect(step(none, NO_KEYS)).toEqual({
      agent: "claude",
      step: "agent",
      ready: false,
    })
  })

  it("goes on to the keys after Set up later, once they're known", () => {
    expect(step(none, null, { later: true }).step).toBe("agent")
    expect(step(none, NO_KEYS, { later: true })).toEqual({
      agent: "claude",
      step: "keys",
      ready: false,
    })
    expect(step(none, ALL_KEYS, { later: true }).ready).toBe(true)
  })

  it("goes back to the agent step when Set up later is undone", () => {
    expect(step(none, ALL_KEYS, { later: false }).step).toBe("agent")
  })

  it("goes on to the keys as soon as the agent is ready", () => {
    expect(step([agent("claude")], NO_KEYS)).toEqual({
      agent: "claude",
      step: "keys",
      ready: false,
    })
    expect(step([agent("claude")], ALL_KEYS)).toEqual({
      agent: "claude",
      step: "keys",
      ready: true,
    })
  })

  it("stays on the agent step while its model picker is open", () => {
    const agents = [agent("claude")]
    expect(step(agents, ALL_KEYS, { pickingFor: "claude" })).toEqual({
      agent: "claude",
      step: "agent",
      ready: false,
    })
    // Another agent's picker, left open, holds nothing up.
    expect(step(agents, ALL_KEYS, { pickingFor: "codex" }).step).toBe("keys")
  })

  it("waits for the effort after a required model pick, then goes on", () => {
    const picking = { pickingFor: "opencode" }
    expect(step([agent("opencode", "pick")], NO_KEYS, picking).step).toBe(
      "agent"
    )
    // The model is picked and the agent ready, with the picker still open.
    expect(step([agent("opencode")], NO_KEYS, picking).step).toBe("agent")
    expect(step([agent("opencode")], NO_KEYS).step).toBe("keys")
  })

  it("keeps Claude Code first when it's installed but not signed in", () => {
    const agents = [agent("claude", "sign_in"), agent("codex")]
    expect(step(agents, ALL_KEYS)).toEqual({
      agent: "claude",
      step: "agent",
      ready: false,
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
