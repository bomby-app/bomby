import { describe, expect, it } from "vite-plus/test"

import { track, written } from "./transcript-writes"

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((done) => (resolve = done))
  return { promise, resolve }
}

describe("a call's transcript writes", () => {
  it("are waited for, every one, failed ones too", async () => {
    const first = deferred()
    const second = Promise.reject(new Error("refused"))
    track(1, first.promise)
    track(1, second)
    let done = false
    const waiting = written(1).then(() => (done = true))
    await Promise.resolve()
    expect(done).toBe(false)
    first.resolve()
    await waiting
    expect(done).toBe(true)
  })

  it("don't hold a call with nothing pending, or past the cap", async () => {
    await written(2)
    track(3, new Promise(() => {}))
    await written(3, 5)
  })
})
