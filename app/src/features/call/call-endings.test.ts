import { describe, expect, it } from "vite-plus/test"

import { callEndings } from "./call-endings"

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((done) => (resolve = done))
  return { promise, resolve }
}

describe("ending a call", () => {
  it("runs once while it's in progress, and a second end waits on the first", async () => {
    const end = callEndings(() => {})
    const work = deferred()
    let runs = 0
    const first = end(1, () => {
      runs++
      return work.promise
    })
    let secondDone = false
    const second = end(1, async () => {
      runs++
    }).then(() => (secondDone = true))
    await Promise.resolve()
    expect(runs).toBe(1)
    expect(secondDone).toBe(false)
    work.resolve()
    await first
    await second
    expect(secondDone).toBe(true)
    expect(runs).toBe(1)
  })

  it("never rejects: a failure goes to the log", async () => {
    const failures: string[] = []
    const end = callEndings((id, e) => failures.push(`${id}: ${String(e)}`))
    await end(2, () => Promise.reject(new Error("refused")))
    expect(failures).toEqual(["2: Error: refused"])
  })

  it("runs again once the last end is over, for a resumed call", async () => {
    const end = callEndings(() => {})
    let runs = 0
    await end(3, async () => {
      runs++
    })
    await end(3, async () => {
      runs++
    })
    expect(runs).toBe(2)
  })

  it("keeps different calls apart", async () => {
    const end = callEndings(() => {})
    const work = deferred()
    let other = false
    void end(4, () => work.promise)
    await end(5, async () => {
      other = true
    })
    expect(other).toBe(true)
    work.resolve()
  })
})
