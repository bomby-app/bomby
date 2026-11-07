import { describe, expect, it } from "vite-plus/test"

import { createReadings } from "./readings"

/** A read that finishes when the test says so. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe("readings", () => {
  it("runs one read at a time and one more for everything asked meanwhile", async () => {
    const cache = createReadings()
    const reads: Array<ReturnType<typeof deferred<string>>> = []
    const load = () => {
      const read = deferred<string>()
      reads.push(read)
      return read.promise
    }
    cache.refresh("a", load)
    cache.refresh("a", load)
    cache.refresh("a", load)
    expect(reads).toHaveLength(1)
    reads[0].resolve("first")
    await tick()
    expect(reads).toHaveLength(2)
    reads[1].resolve("last")
    await tick()
    expect(reads).toHaveLength(2)
    expect(cache.snapshot("a").data).toBe("last")
  })

  it("tells listeners and keeps the last answer while reading again", async () => {
    const cache = createReadings()
    let heard = 0
    cache.subscribe("a", () => heard++)
    expect(cache.snapshot("a").loading).toBe(true)
    cache.refresh("a", () => Promise.resolve(1))
    await tick()
    expect(cache.snapshot("a")).toEqual({
      data: 1,
      error: null,
      loading: false,
    })
    const next = deferred<number>()
    cache.refresh("a", () => next.promise)
    expect(cache.snapshot("a").data).toBe(1)
    next.resolve(2)
    await tick()
    expect(cache.snapshot("a").data).toBe(2)
    expect(heard).toBe(2)
  })

  it("says what failed", async () => {
    const cache = createReadings()
    cache.refresh("a", () => Promise.reject(new Error("gone")))
    await tick()
    expect(cache.snapshot("a").error).toBe("Error: gone")
  })

  it("drops the readings nobody has shown for longest, never one on screen", async () => {
    const cache = createReadings({ idle: 2 })
    const stop = cache.subscribe("shown", () => {})
    for (const key of ["shown", "a", "b", "c"]) {
      cache.refresh(key, () => Promise.resolve(key))
      await tick()
    }
    expect(cache.snapshot("shown").data).toBe("shown")
    // "a" was the least recent unused one; reading it again starts empty.
    expect(cache.snapshot("a").loading).toBe(true)
    stop()
  })
})
