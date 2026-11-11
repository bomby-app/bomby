import { describe, expect, it } from "vite-plus/test"

import { keyFields } from "./key-fields"

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
