import { RpcError } from "livekit-client"

import { REFUSED } from "@/features/extensions/rpc"

import type { Task } from "./tasks"

/** Whether the user can stop `task`: it hasn't started yet or is still running. */
export function stoppable(task: Task): boolean {
  return task.status === "queued" || task.status === "working"
}

/**
 * Sends each stop once: `stop(id)` asks the agent through `perform`, and does nothing for
 * an id already asked for, so a second click never sends a second stop. A failed stop can
 * be sent again; `onChange` hears the ids asked for each time they change, and `onError`
 * what the user should read when one fails.
 */
export function taskStops(
  perform: (id: string) => Promise<unknown>,
  onChange: (asked: ReadonlySet<string>) => void,
  onError: (message: string) => void
): (id: string) => void {
  const asked = new Set<string>()
  return (id) => {
    if (asked.has(id)) return
    asked.add(id)
    onChange(new Set(asked))
    perform(id).catch((e: unknown) => {
      asked.delete(id)
      onChange(new Set(asked))
      onError(stopFailure(e))
    })
  }
}

/** What the user reads when a stop fails: the agent's own reason when it gave one. */
export function stopFailure(e: unknown): string {
  return e instanceof RpcError && e.code === REFUSED
    ? e.message
    : "Bomby couldn't stop that task."
}
