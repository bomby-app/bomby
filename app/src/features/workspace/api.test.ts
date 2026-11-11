import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { openTerminal, watchFolder } from "./api"

const invoke = vi.hoisted(() => vi.fn())
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  // The page only sets `onmessage` on a channel; the core's ids arrive as the answer.
  Channel: class {},
}))

describe("a workspace the page gave up waiting for", () => {
  beforeEach(() => {
    invoke.mockReset()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  function coreThatAnswersLate(command: string) {
    let finish: (id: number) => void = () => {}
    const cleaned: number[] = []
    invoke.mockImplementation((name: string, args?: { id?: number }) => {
      if (name === "keychain_asking") return Promise.resolve(false)
      if (name === "app_log") return Promise.resolve()
      if (name === "terminal_close" || name === "unwatch_folder") {
        cleaned.push(args?.id ?? -1)
        return Promise.resolve()
      }
      if (name === command) return new Promise((resolve) => (finish = resolve))
      return Promise.resolve()
    })
    return { finish: (value: number) => finish(value), cleaned }
  }

  it("closes a shell the core starts after the tab gave up, so it runs no more", async () => {
    const { finish, cleaned } = coreThatAnswersLate("terminal_open")
    const opened = openTerminal({
      projectId: 1,
      folder: "/Users/me/project",
      cols: 80,
      rows: 24,
      onOutput: () => {},
      onExit: () => {},
    })
    const rejected = expect(opened).rejects.toBeDefined()
    await vi.advanceTimersByTimeAsync(22_000)
    await rejected
    expect(cleaned).toEqual([])
    finish(4)
    await vi.advanceTimersByTimeAsync(0)
    expect(cleaned).toEqual([4])
  })

  it("stops a watch the core starts after the panel gave up", async () => {
    const { finish, cleaned } = coreThatAnswersLate("watch_folder")
    const watched = watchFolder(1, "/Users/me/project", () => {})
    const rejected = expect(watched).rejects.toBeDefined()
    await vi.advanceTimersByTimeAsync(22_000)
    await rejected
    expect(cleaned).toEqual([])
    finish(7)
    await vi.advanceTimersByTimeAsync(0)
    expect(cleaned).toEqual([7])
  })

  it("keeps a terminal that opens in time for the tab to use", async () => {
    const cleaned: number[] = []
    invoke.mockImplementation((name: string, args?: { id?: number }) => {
      if (name === "terminal_close") {
        cleaned.push(args?.id ?? -1)
        return Promise.resolve()
      }
      if (name === "terminal_open") return Promise.resolve(4)
      return Promise.resolve()
    })
    const session = await openTerminal({
      projectId: 1,
      folder: "/Users/me/project",
      cols: 80,
      rows: 24,
      onOutput: () => {},
      onExit: () => {},
    })
    await vi.advanceTimersByTimeAsync(22_000)
    expect(cleaned).toEqual([])
    session.close()
    expect(cleaned).toEqual([4])
  })
})
