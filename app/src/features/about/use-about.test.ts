import { describe, expect, it } from "vite-plus/test"

import type { About, UpdateStatus } from "./api"
import { aboutStore } from "./use-about"

const ABOUT: About = { version: "1.2.0", status: { kind: "upToDate" } }

/** Subscribes, as a component would, and waits for the reads to settle. */
async function started(store: ReturnType<typeof aboutStore>) {
  store.subscribe(() => {})
  await new Promise((done) => setTimeout(done, 0))
  return store.get()
}

describe("About's store", () => {
  it("holds the core's answer", async () => {
    const store = aboutStore({
      about: async () => ABOUT,
      onUpdateStatus: async () => () => {},
    })
    expect(await started(store)).toEqual({ info: ABOUT, error: null })
  })

  it("holds the error when the read fails, rather than staying blank", async () => {
    const store = aboutStore({
      about: () => Promise.reject(new Error("no core")),
      onUpdateStatus: async () => () => {},
    })
    expect(await started(store)).toEqual({
      info: null,
      error: "Error: no core",
    })
  })

  it("holds the error when following updates fails", async () => {
    const store = aboutStore({
      about: async () => ABOUT,
      onUpdateStatus: () => Promise.reject(new Error("no events")),
    })
    expect((await started(store)).error).toBe("Error: no events")
  })

  it("lets an update status that lands during the read win", async () => {
    const downloaded: UpdateStatus = { kind: "downloaded", version: "1.3.0" }
    const store = aboutStore({
      about: async () => ABOUT,
      onUpdateStatus: async (handler) => {
        handler(downloaded)
        return () => {}
      },
    })
    expect((await started(store)).info?.status).toEqual(downloaded)
  })
})
