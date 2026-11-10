import { RpcError } from "livekit-client"
import { describe, expect, it } from "vite-plus/test"

import { REFUSED } from "@/features/extensions/rpc"

import { stopFailure, stoppable, taskStops } from "./task-stops"
import type { Task } from "./tasks"

function task(status: Task["status"]): Task {
  return {
    id: "1",
    agent: "claude",
    agentName: "Claude",
    session: "page",
    task: "fix the header",
    status,
    startedAt: 0,
    endedAt: null,
  }
}

function deferred() {
  let resolve = () => {}
  let reject = (_e: unknown) => {}
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe("stopping a task", () => {
  it("is offered while a task waits or runs, never once it's over", () => {
    expect(stoppable(task("queued"))).toBe(true)
    expect(stoppable(task("working"))).toBe(true)
    for (const status of ["added", "done", "failed", "stopped"] as const) {
      expect(stoppable(task(status))).toBe(false)
    }
  })

  it("sends one stop however often it's asked", async () => {
    const answer = deferred()
    const sent: string[] = []
    const stop = taskStops(
      (id) => {
        sent.push(id)
        return answer.promise
      },
      () => {},
      () => {}
    )
    stop("1")
    stop("1")
    answer.resolve()
    await answer.promise
    stop("1")
    expect(sent).toEqual(["1"])
  })

  it("can be sent again after it fails, and says why", async () => {
    const answers = [deferred(), deferred()]
    const sent: string[] = []
    const errors: string[] = []
    const asked: string[][] = []
    const stop = taskStops(
      (id) => answers[sent.push(id) - 1]!.promise,
      (ids) => asked.push([...ids]),
      (message) => errors.push(message)
    )
    stop("2")
    answers[0]!.reject(new RpcError(REFUSED, "That task has already ended."))
    await answers[0]!.promise.catch(() => {})
    await Promise.resolve()
    expect(errors).toEqual(["That task has already ended."])
    expect(asked).toEqual([["2"], []])
    stop("2")
    expect(sent).toEqual(["2", "2"])
  })

  it("names the agent's refusal, and anything else plainly", () => {
    expect(
      stopFailure(new RpcError(REFUSED, "That task isn't kept anymore."))
    ).toBe("That task isn't kept anymore.")
    expect(stopFailure(new RpcError(1502, "Response timeout"))).toBe(
      "Bomby couldn't stop that task."
    )
    expect(stopFailure(new Error("no voice agent in the call"))).toBe(
      "Bomby couldn't stop that task."
    )
  })
})
