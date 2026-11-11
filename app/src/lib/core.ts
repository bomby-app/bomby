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
 * What a command that didn't answer in time rejects with while the core waits on the
 * keychain: on a Mac, macOS asking for the user's password. The screen then says so instead
 * of {@link NOT_ANSWERING}, and reads again once the keys are read (`keys-changed`).
 */
export const KEYCHAIN_ASKING =
  "macOS is asking for your password so Bomby can read your keys. Answer it, and this fills in."

/** How long the page waits to learn whether the core is waiting on the keychain. */
const ASKING_CHECK = 2_000

/**
 * Why a command didn't answer in time: {@link KEYCHAIN_ASKING} when the core is waiting on
 * the keychain right now, else {@link NOT_ANSWERING}. The question takes no lock in the core,
 * so it answers even while the keys are held.
 */
export async function whyNotAnswering(
  asking: () => Promise<boolean> = () => invoke<boolean>("keychain_asking")
): Promise<string> {
  const unknown = new Promise<boolean>((resolve) =>
    setTimeout(() => resolve(false), ASKING_CHECK)
  )
  const waiting = await Promise.race([asking().catch(() => false), unknown])
  return waiting ? KEYCHAIN_ASKING : NOT_ANSWERING
}

/**
 * Calls a core command, like `invoke`, and stops waiting after `timeout` ms, rejecting
 * with why ({@link whyNotAnswering}); the core may still finish the work. `null` waits as long as it takes: only for what waits on the
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
      void whyNotAnswering().then((why) => {
        const waiting =
          why === KEYCHAIN_ASKING ? ", waiting on the keychain" : ""
        log(`${command} didn't answer in ${timeout / 1000} s${waiting}`)
        // oxlint-disable-next-line prefer-promise-reject-errors -- the core's errors are strings too
        reject(why)
      })
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
