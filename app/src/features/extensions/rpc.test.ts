import { RpcError } from "livekit-client"
import { describe, expect, it } from "vite-plus/test"

import { answer, methods, record, Refusal, REFUSED, type RpcCall } from "./rpc"

const CALL: RpcCall = { projectId: 1, callId: 1 }

describe("extension RPC", () => {
  it("names each operation after its extension", () => {
    const handler = async () => null
    expect(
      methods({ id: "todos", handlers: { add: handler, list: handler } }).map(
        ([method]) => method
      )
    ).toEqual(["bomby.todos.add", "bomby.todos.list"])
  })

  it("answers with JSON, given the call and its project", async () => {
    const handler = async (payload: unknown, call: RpcCall) => ({
      payload,
      ...call,
    })
    expect(
      await answer(handler, '{"status":"open"}', { projectId: 7, callId: 3 })
    ).toBe('{"payload":{"status":"open"},"projectId":7,"callId":3}')
  })

  it("sends what the core refuses, and a refusal, back for Bomby to say", async () => {
    const core = async () => Promise.reject("There's no to-do number 9.")
    await expect(answer(core, "{}", CALL)).rejects.toEqual(
      new RpcError(REFUSED, "There's no to-do number 9.")
    )
    const refusal = async () => {
      throw new Refusal("Say what to add.")
    }
    await expect(answer(refusal, "{}", CALL)).rejects.toMatchObject({
      code: REFUSED,
      message: "Say what to add.",
    })
    await expect(answer(refusal, "not json", CALL)).rejects.toMatchObject({
      code: REFUSED,
    })
  })

  it("leaves a bug as LiveKit's own error", async () => {
    const bug = async () => {
      throw new TypeError("oops")
    }
    await expect(answer(bug, "{}", CALL)).rejects.toBeInstanceOf(TypeError)
  })

  it("reads only an object as a request", () => {
    expect(record({ a: 1 })).toEqual({ a: 1 })
    for (const bad of [null, [], "x", 3])
      expect(() => record(bad)).toThrow(Refusal)
  })
})
