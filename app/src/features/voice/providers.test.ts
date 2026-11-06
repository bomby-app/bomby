import { describe, expect, it } from "vite-plus/test"

import catalogue from "../../../src-tauri/voice-providers.json"
import { KEY_PAGES } from "./key-pages"
import { PROVIDER_ORDER, PROVIDERS } from "./providers"

// The agent's providers, as the core embeds them (`just agent providers`).
const providers = catalogue.providers

describe("provider copy", () => {
  it("covers every provider the agent has, in its order", () => {
    const ids = providers.map((p) => p.id)
    expect(PROVIDER_ORDER).toEqual(ids)
    expect(new Set(Object.keys(PROVIDERS))).toEqual(new Set(ids))
    expect(new Set(Object.keys(KEY_PAGES))).toEqual(new Set(ids))
  })

  it("names each provider as the agent does and describes each of its options", () => {
    for (const provider of providers) {
      const copy = PROVIDERS[provider.id as keyof typeof PROVIDERS]
      expect(copy.name).toBe(provider.name)
      expect(new Set(Object.keys(copy.options))).toEqual(
        new Set(provider.options.map((o) => o.id))
      )
      for (const option of provider.options)
        expect(copy.options[option.id]?.kind).toBe(option.kind)
    }
  })
})
