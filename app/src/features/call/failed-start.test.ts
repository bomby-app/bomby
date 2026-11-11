import { describe, expect, it } from "vite-plus/test"

import { endFailedStart } from "./failed-start"

function session(joined: number | null) {
  const done: string[] = []
  return {
    done,
    joined: () => joined,
    endSession: () => {
      done.push("session")
      return Promise.resolve()
    },
    finish: (id: number) => {
      done.push(`call ${id}`)
      return Promise.resolve()
    },
  }
}

describe("a start that failed or was cancelled", () => {
  it("leaves a newer call on the session alone, and ends only its own call", async () => {
    // Call 1 was cancelled, call 2 started, then call 1's opening answered.
    const s = session(2)
    await endFailedStart(1, s)
    expect(s.done).toEqual(["call 1"])
  })

  it("ends the session it joined, then its call", async () => {
    const s = session(1)
    await endFailedStart(1, s)
    expect(s.done).toEqual(["session", "call 1"])
  })

  it("ends its call even when ending the session fails", async () => {
    const s = session(1)
    await endFailedStart(1, {
      ...s,
      endSession: () => Promise.reject(new Error("gone")),
    })
    expect(s.done).toEqual(["call 1"])
  })
})
