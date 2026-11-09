import { describe, expect, it } from "vite-plus/test"

import { serialReload } from "./serial-reload"

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

describe("a serial reload", () => {
  it("reads once at a time, applies only the latest, and settles every ask after it", async () => {
    const reads = [deferred<string>(), deferred<string>()]
    let calls = 0
    const applied: string[] = []
    const reload = serialReload(
      () => reads[calls++]!.promise,
      (value) => applied.push(value)
    )

    const first = reload()
    const second = reload() // a change during the first read
    const third = reload()
    expect(calls).toBe(1)

    reads[0]!.resolve("A")
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toBe(2)
    reads[1]!.resolve("B")
    await Promise.all([first, second, third])
    expect(applied).toEqual(["B"])
  })

  it("starts over after a failed read", async () => {
    let fail = true
    const applied: number[] = []
    const reload = serialReload(
      async () => {
        if (fail) throw new Error("gone")
        return 1
      },
      (value) => applied.push(value)
    )
    await expect(reload()).rejects.toThrow("gone")
    fail = false
    await reload()
    expect(applied).toEqual([1])
  })
})
