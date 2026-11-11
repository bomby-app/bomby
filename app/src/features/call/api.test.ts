import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { openCall } from "./api"

const invoke = vi.hoisted(() => vi.fn())
vi.mock("@tauri-apps/api/core", () => ({ invoke }))

describe("opening a call", () => {
  beforeEach(() => {
    invoke.mockReset()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it("ends a call the core opens after the page gave up, so it holds off no update", async () => {
    let finish: (callId: number) => void = () => {}
    const ended: number[] = []
    invoke.mockImplementation((command: string, args?: { callId?: number }) => {
      if (command === "keychain_asking") return Promise.resolve(false)
      if (command === "app_log") return Promise.resolve()
      if (command === "end_call") {
        ended.push(args?.callId ?? -1)
        return Promise.resolve()
      }
      return new Promise((resolve) => (finish = resolve))
    })
    const start = openCall(1)
    const rejected = expect(start).rejects.toBeDefined()
    // The two minutes the page waits, then up to 2 s to learn why.
    await vi.advanceTimersByTimeAsync(122_000)
    await rejected
    expect(ended).toEqual([])
    // The core answers late: the call it opened must be ended, not left open.
    finish(9)
    await vi.advanceTimersByTimeAsync(0)
    expect(ended).toEqual([9])
  })

  it("keeps a call that opens in time for the start to join", async () => {
    const ended: number[] = []
    invoke.mockImplementation((command: string, args?: { callId?: number }) => {
      if (command === "end_call") {
        ended.push(args?.callId ?? -1)
        return Promise.resolve()
      }
      if (command === "open_call") return Promise.resolve(9)
      return Promise.resolve()
    })
    await expect(openCall(1)).resolves.toBe(9)
    await vi.advanceTimersByTimeAsync(122_000)
    expect(ended).toEqual([])
  })
})
