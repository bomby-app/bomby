import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { call, NOT_ANSWERING } from "./core"

const invoke = vi.hoisted(() => vi.fn())
vi.mock("@tauri-apps/api/core", () => ({ invoke }))

describe("calling the core", () => {
  beforeEach(() => {
    invoke.mockReset()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it("answers as the core does", async () => {
    invoke.mockResolvedValue(true)
    await expect(call("first_run")).resolves.toBe(true)
    invoke.mockRejectedValue("database: locked")
    await expect(call("first_run")).rejects.toBe("database: locked")
  })

  it("stops waiting on a core that never answers, and says so in the log", async () => {
    invoke.mockImplementation((command: string) =>
      command === "app_log" ? Promise.resolve() : new Promise(() => {})
    )
    const answer = call("first_run", undefined, { timeout: 8000 })
    const rejected = expect(answer).rejects.toBe(NOT_ANSWERING)
    await vi.advanceTimersByTimeAsync(8000)
    await rejected
    expect(invoke).toHaveBeenCalledWith("app_log", {
      line: "first_run didn't answer in 8 s",
    })
  })

  it("waits as long as it takes when told to", async () => {
    let finish: (value: string) => void = () => {}
    invoke.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const answer = call(
      "connect_extension",
      { id: "zapier" },
      { timeout: null }
    )
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    finish("signed in")
    await expect(answer).resolves.toBe("signed in")
  })
})
