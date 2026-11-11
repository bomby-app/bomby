import type { AgentStatus, KeyField } from "./api"

/**
 * The key fields an agent's row shows: those it asks for now, then any key saved for it it
 * no longer asks for (another provider's), so a saved key can always be replaced or removed.
 */
export function keyFields(offered: KeyField[], saved: string[]): KeyField[] {
  const others = saved
    .filter((name) => !offered.some((field) => field.name === name))
    .map((name) => ({ name, label: name, secret: true, optional: true }))
  return [...offered, ...others]
}

/**
 * Whether an agent that didn't answer in time may be waiting on macOS asking for a password:
 * it takes keys and none is saved for it in Bomby, so it reads its own from the keychain,
 * which macOS asks about for an agent it doesn't trust yet (goose after an update). Only a
 * likely cause, never certain, and false while the saved keys aren't `known`.
 */
export function mayBeAskingForPassword(
  { setup }: AgentStatus,
  saved: string[],
  known: boolean
): boolean {
  return (
    known &&
    setup?.step === "unreachable" &&
    setup.timedOut &&
    setup.keys.length > 0 &&
    !setup.keys.some((key) => saved.includes(key.name))
  )
}
