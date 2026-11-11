import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { call, KEYCHAIN_ASKING, NOT_ANSWERING } from "./core"

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
    // Then up to 2 s to learn whether it's waiting on the keychain; here it never says.
    await vi.advanceTimersByTimeAsync(10_000)
    await rejected
    expect(invoke).toHaveBeenCalledWith("app_log", {
      line: "first_run didn't answer in 8 s",
    })
  })

  it("says macOS is asking for a password while the core waits on the keychain", async () => {
    invoke.mockImplementation((command: string) => {
      if (command === "keychain_asking") return Promise.resolve(true)
      if (command === "app_log") return Promise.resolve()
      return new Promise(() => {})
    })
    const answer = call("credentials_info")
    const rejected = expect(answer).rejects.toBe(KEYCHAIN_ASKING)
    await vi.advanceTimersByTimeAsync(20_000)
    await rejected
    expect(invoke).toHaveBeenCalledWith("app_log", {
      line: "credentials_info didn't answer in 20 s, waiting on the keychain",
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

  it("gives an answer that arrives after it gave up to late, to clean up", async () => {
    let finish: (value: number) => void = () => {}
    invoke.mockImplementation((command: string) => {
      if (command === "keychain_asking") return Promise.resolve(false)
      if (command === "app_log") return Promise.resolve()
      return new Promise((resolve) => (finish = resolve))
    })
    const late = vi.fn()
    const answer = call("open_call", undefined, { timeout: 8000, late })
    const rejected = expect(answer).rejects.toBe(NOT_ANSWERING)
    await vi.advanceTimersByTimeAsync(10_000)
    await rejected
    expect(late).not.toHaveBeenCalled()
    finish(9)
    await vi.advanceTimersByTimeAsync(0)
    expect(late).toHaveBeenCalledWith(9)
  })

  it("doesn't call late for an answer in time", async () => {
    invoke.mockResolvedValue(7)
    const late = vi.fn()
    await expect(call("open_call", undefined, { late })).resolves.toBe(7)
    expect(late).not.toHaveBeenCalled()
  })

  it("drops a late failure: the page already showed why it gave up", async () => {
    let fail: (e: unknown) => void = () => {}
    invoke.mockImplementation((command: string) => {
      if (command === "keychain_asking") return Promise.resolve(false)
      if (command === "app_log") return Promise.resolve()
      return new Promise((_, reject) => (fail = reject))
    })
    const late = vi.fn()
    const answer = call("open_call", undefined, { timeout: 8000, late })
    const rejected = expect(answer).rejects.toBe(NOT_ANSWERING)
    await vi.advanceTimersByTimeAsync(10_000)
    await rejected
    fail("database: locked")
    await vi.advanceTimersByTimeAsync(0)
    expect(late).not.toHaveBeenCalled()
  })
})
