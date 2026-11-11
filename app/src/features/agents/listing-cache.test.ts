import { describe, expect, it } from "vite-plus/test"

import type { Listed } from "./api"
import {
  forgetAgentListing,
  keepListing,
  keptListing,
  listingGeneration,
  onAgentListingForgotten,
} from "./listing-cache"

function listed(model: string): Listed {
  return {
    step: "ready",
    problem: null,
    fix: null,
    account: null,
    model,
    adapter: null,
    skipped: [],
    session: true,
    keys: [],
    setupFiles: [],
    settings: [],
  }
}

describe("listing cache", () => {
  it("drops an answer that was on its way when the agent's keys changed", () => {
    const asked = listingGeneration("goose")
    expect(keepListing("goose", asked, listed("old"))).toBe(true)

    const askedAgain = listingGeneration("goose")
    const forgotten: string[] = []
    const stop = onAgentListingForgotten((agent) => forgotten.push(agent))
    forgetAgentListing("goose")
    stop()

    expect(forgotten).toEqual(["goose"])
    expect(keptListing("goose")).toBeUndefined()
    // The answer to a question asked before the change isn't kept or shown.
    expect(keepListing("goose", askedAgain, listed("stale"))).toBe(false)
    expect(keptListing("goose")).toBeUndefined()
    expect(
      keepListing("goose", listingGeneration("goose"), listed("fresh"))
    ).toBe(true)
    expect(keptListing("goose")?.model).toBe("fresh")
  })

  it("leaves other agents' answers alone", () => {
    keepListing("omp", listingGeneration("omp"), listed("omp-model"))
    forgetAgentListing("goose")
    expect(keptListing("omp")?.model).toBe("omp-model")
  })
})
