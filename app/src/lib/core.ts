import { type InvokeArgs, invoke } from "@tauri-apps/api/core"

import { log } from "./log"

/**
 * How long the page waits for most of the core's answers: reading or saving a setting, a
 * project, a key. Tauri's `invoke` has no timeout of its own, so a core that never answers
 * (Bomby 0.3.2's deadlock) would leave a screen waiting forever; with one, every wait ends
 * in an answer or an error the screen shows.
 */
export const QUICK = 20_000

/** For a command that starts a coding agent (a probe, up to a minute in the core). */
export const AGENT_PROBE = 90_000

/** For the first look for the agents, the login shell and every agent's probe. */
export const AGENTS_LOOK = 120_000

/**
 * What a command that didn't answer in time rejects with. A string, as the core's own errors
 * are, so every screen shows it the way it shows those.
 */
export const NOT_ANSWERING =
  "Bomby's core isn't answering. Try again; if it keeps happening, quit Bomby and open it again."

/**
 * Calls a core command, like `invoke`, and stops waiting after `timeout` ms, rejecting
 * with {@link NOT_ANSWERING}; the core may still finish the work. `null` waits as long as it takes: only for what waits on the
 * user (a browser sign-in) or a download.
 */
export function call<T>(
  command: string,
  args?: InvokeArgs,
  { timeout = QUICK }: { timeout?: number | null } = {}
): Promise<T> {
  const answer = invoke<T>(command, args)
  if (timeout === null) return answer
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      log(`${command} didn't answer in ${timeout / 1000} s`)
      // oxlint-disable-next-line prefer-promise-reject-errors -- the core's errors are strings too
      reject(NOT_ANSWERING)
    }, timeout)
    answer.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}
