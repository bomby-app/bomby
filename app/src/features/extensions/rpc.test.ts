import { RpcError } from "livekit-client"
import { describe, expect, it } from "vite-plus/test"

import { answer, methods, record, Refusal, REFUSED } from "./rpc"

describe("extension RPC", () => {
  it("names each operation after its extension", () => {
    const handler = async () => null
    expect(
      methods({ id: "todos", handlers: { add: handler, list: handler } }).map(
        ([method]) => method
      )
    ).toEqual(["bomby.todos.add", "bomby.todos.list"])
  })

  it("answers with JSON, given the call's project", async () => {
    const handler = async (payload: unknown, projectId: number) => ({
      payload,
      projectId,
    })
    expect(await answer(handler, '{"status":"open"}', 7)).toBe(
      '{"payload":{"status":"open"},"projectId":7}'
    )
  })

  it("sends what the core refuses, and a refusal, back for Bomby to say", async () => {
    const core = async () => Promise.reject("There's no to-do number 9.")
    await expect(answer(core, "{}", 1)).rejects.toEqual(
      new RpcError(REFUSED, "There's no to-do number 9.")
    )
    const refusal = async () => {
      throw new Refusal("Say what to add.")
    }
    await expect(answer(refusal, "{}", 1)).rejects.toMatchObject({
      code: REFUSED,
      message: "Say what to add.",
    })
    await expect(answer(refusal, "not json", 1)).rejects.toMatchObject({
      code: REFUSED,
    })
  })

  it("leaves a bug as LiveKit's own error", async () => {
    const bug = async () => {
      throw new TypeError("oops")
    }
    await expect(answer(bug, "{}", 1)).rejects.toBeInstanceOf(TypeError)
  })

  it("reads only an object as a request", () => {
    expect(record({ a: 1 })).toEqual({ a: 1 })
    for (const bad of [null, [], "x", 3])
      expect(() => record(bad)).toThrow(Refusal)
  })
})
