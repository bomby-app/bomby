import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { watchAgentStreams } from "./api"

const invoke = vi.hoisted(() => vi.fn())
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  // The page only sets `onmessage` on a channel; the core's id arrives as the answer.
  Channel: class {},
}))

describe("following a call's agents", () => {
  beforeEach(() => {
    invoke.mockReset()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  function core({ late }: { late: boolean }) {
    let finish: (id: number) => void = () => {}
    const unwatched: number[] = []
    invoke.mockImplementation((name: string, args?: { id?: number }) => {
      if (name === "unwatch_agent_streams") {
        unwatched.push(args?.id ?? -1)
        return Promise.resolve()
      }
      if (name === "watch_agent_streams")
        return late
          ? new Promise((resolve) => (finish = resolve))
          : Promise.resolve(3)
      return Promise.resolve(false)
    })
    return { finish: (id: number) => finish(id), unwatched }
  }

  it("stops a watch the core starts after the panel gave up", async () => {
    const { finish, unwatched } = core({ late: true })
    const watched = watchAgentStreams(1, () => {})
    const rejected = expect(watched).rejects.toBeDefined()
    await vi.advanceTimersByTimeAsync(22_000)
    await rejected
    expect(unwatched).toEqual([])
    finish(3)
    await vi.advanceTimersByTimeAsync(0)
    expect(unwatched).toEqual([3])
  })

  it("keeps a watch that starts in time until the panel stops it", async () => {
    const { unwatched } = core({ late: false })
    const stop = await watchAgentStreams(1, () => {})
    await vi.advanceTimersByTimeAsync(22_000)
    expect(unwatched).toEqual([])
    stop()
    expect(unwatched).toEqual([3])
  })
})
