import { describe, expect, it } from "vite-plus/test"

import type { AgentStatus, Setup } from "./api"
import { keyFields, mayBeAskingForPassword } from "./key-fields"

const OPENROUTER = {
  name: "OPENROUTER_API_KEY",
  label: "OpenRouter API key",
  secret: true,
  optional: false,
}

describe("keyFields", () => {
  it("shows what the agent asks for, then saved keys it no longer asks for", () => {
    expect(keyFields([OPENROUTER], [])).toEqual([OPENROUTER])
    expect(
      keyFields([OPENROUTER], ["OPENROUTER_API_KEY", "ANTHROPIC_API_KEY"]).map(
        (f) => f.name
      )
    ).toEqual(["OPENROUTER_API_KEY", "ANTHROPIC_API_KEY"])
    // An agent that asks for none still shows the one saved for it, to remove.
    expect(keyFields([], ["ANTHROPIC_API_KEY"])).toEqual([
      {
        name: "ANTHROPIC_API_KEY",
        label: "ANTHROPIC_API_KEY",
        secret: true,
        optional: true,
      },
    ])
  })
})

describe("mayBeAskingForPassword", () => {
  const goose = (setup: Partial<Setup>): AgentStatus => ({
    id: "goose",
    name: "goose",
    path: "/Users/me/.local/bin/goose",
    version: null,
    installPage: "https://example.com",
    check: "goose --version",
    setup: {
      step: "unreachable",
      problem: "It didn't answer in time",
      fix: null,
      account: null,
      model: null,
      adapter: null,
      skipped: [],
      session: false,
      keys: [OPENROUTER],
      setupFiles: [],
      timedOut: true,
      ...setup,
    },
  })

  it("says so for an agent that timed out reading its own keys", () => {
    expect(mayBeAskingForPassword(goose({}), [], true)).toBe(true)
  })

  it("doesn't once its key is saved, or while that isn't known", () => {
    expect(
      mayBeAskingForPassword(goose({}), ["OPENROUTER_API_KEY"], true)
    ).toBe(false)
    expect(mayBeAskingForPassword(goose({}), [], false)).toBe(false)
  })

  it("doesn't for another failure, or an agent that takes no keys", () => {
    expect(mayBeAskingForPassword(goose({ timedOut: false }), [], true)).toBe(
      false
    )
    expect(mayBeAskingForPassword(goose({ keys: [] }), [], true)).toBe(false)
    expect(mayBeAskingForPassword(goose({ step: "sign_in" }), [], true)).toBe(
      false
    )
  })
})
