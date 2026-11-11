import type { Listed } from "./api"

/**
 * Each agent's last answer to the model picker, for this page: asking takes seconds (the
 * agent starts), so it's asked once and kept, kept up to date by every pick, until the user
 * refreshes or the agent's keys change. A change starts a new generation for that agent, so
 * an answer still on its way from before is dropped, and tells the mounted pickers.
 */
const lastListed = new Map<string, Listed>()
const generations = new Map<string, number>()
const listeners = new Set<(agent: string) => void>()

export function keptListing(agent: string): Listed | undefined {
  return lastListed.get(agent)
}

/** Keeps `listed` as `agent`'s answer, if it's from the current generation. */
export function keepListing(
  agent: string,
  generation: number,
  listed: Listed
): boolean {
  if (generation !== listingGeneration(agent)) return false
  // Only a real answer is kept: one without a session (a timeout) is asked again.
  if (listed.session) lastListed.set(agent, listed)
  return true
}

/** The current generation of `agent`'s answers. */
export function listingGeneration(agent: string): number {
  return generations.get(agent) ?? 0
}

/** Forgets every agent's answer (Refresh models). */
export function forgetListedSettings(): void {
  lastListed.clear()
}

/**
 * Forgets `agent`'s answer and starts a new generation (its keys changed, so its models
 * may have): pickers showing it ask again.
 */
export function forgetAgentListing(agent: string): void {
  lastListed.delete(agent)
  generations.set(agent, listingGeneration(agent) + 1)
  for (const listener of listeners) listener(agent)
}

/** Calls `listener` with each agent whose answer is forgotten; returns the unsubscribe. */
export function onAgentListingForgotten(
  listener: (agent: string) => void
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
