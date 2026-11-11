import { describe, expect, it } from "vite-plus/test"

import { patchCache } from "./patch-cache"

describe("the patch cache", () => {
  it("parses each patch once while it's shown", () => {
    const parsed: string[] = []
    const read = patchCache((patch) => {
      parsed.push(patch)
      return { patch }
    })
    const first = read(["a", "b"])
    const again = read(["a", "b"])
    expect(parsed).toEqual(["a", "b"])
    expect(again.get("a")).toBe(first.get("a"))
    read(["a", "c"])
    expect(parsed).toEqual(["a", "b", "c"])
  })

  it("drops a patch no longer shown", () => {
    const parsed: string[] = []
    const read = patchCache((patch) => parsed.push(patch))
    read(["a"])
    read(["b"])
    read(["a"])
    expect(parsed).toEqual(["a", "b", "a"])
  })

  it("keeps a parse that found nothing", () => {
    let runs = 0
    const read = patchCache(() => {
      runs++
      return undefined
    })
    read(["x"])
    read(["x"])
    expect(runs).toBe(1)
  })
})
