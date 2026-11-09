import { describe, expect, it } from "vite-plus/test"

import { snippetParts } from "./snippet"

describe("call snippets", () => {
  it("split into what matched and what didn't", () => {
    expect(
      snippetParts("…the \u0002remind\u0003ers on \u0002iOS\u0003")
    ).toEqual([
      { text: "…the ", match: false },
      { text: "remind", match: true },
      { text: "ers on ", match: false },
      { text: "iOS", match: true },
    ])
  })

  it("keep text with no marks whole", () => {
    expect(snippetParts("plain")).toEqual([{ text: "plain", match: false }])
    expect(snippetParts("")).toEqual([])
  })
})
