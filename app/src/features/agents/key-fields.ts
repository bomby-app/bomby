import type { KeyField } from "./api"

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
