import { useCallback, useEffect, useState } from "react"

import { agentSettings, type Listed, pickAgentSettings } from "./api"
import {
  keepListing,
  keptListing,
  listingGeneration,
  onAgentListingForgotten,
} from "./listing-cache"

export { forgetAgentListing, forgetListedSettings } from "./listing-cache"

/** An agent's settings as it last listed them, and what the user does with them. */
export type AgentSettings = {
  /** Null until the agent first answers. */
  listed: Listed | null
  /** What it's waiting on the agent for: its settings, or a pick to save. */
  busy: "loading" | "saving" | null
  error: string | null
  /** Shows what the agent lets the user pick: its kept answer, or else asks it (a few
   * seconds). */
  load: () => void
  /** Saves a pick for one setting: shown at once, then the agent's answer, with anything the
   * pick changed (goose's models follow its provider). */
  pick: (setting: string, value: string) => void
}

/**
 * `agent`'s settings for the model picker and the Agents row. Its state belongs to one
 * agent: give the component that calls it a `key` of the agent's id, so another agent
 * starts fresh rather than on this one's answers.
 */
export function useAgentSettings(agent: string): AgentSettings {
  const [listed, setListed] = useState<Listed | null>(
    () => keptListing(agent) ?? null
  )
  const [busy, setBusy] = useState<AgentSettings["busy"]>(null)
  const [error, setError] = useState<string | null>(null)

  // Waits on the agent for `request`'s answer. One to a question asked before the agent's
  // keys changed is dropped.
  const settle = useCallback(
    (request: () => Promise<Listed>, waiting: "loading" | "saving") => {
      const generation = listingGeneration(agent)
      setBusy(waiting)
      request().then(
        (next) => {
          if (!keepListing(agent, generation, next)) return
          setListed(next)
          setError(null)
          setBusy(null)
        },
        (e: unknown) => {
          if (generation !== listingGeneration(agent)) return
          // Back to what the agent last confirmed, not the pick that didn't save.
          setListed(keptListing(agent) ?? null)
          setError(String(e))
          setBusy(null)
        }
      )
    },
    [agent]
  )

  // Its keys changed: a picker showing its answer, or waiting on one (which is dropped now),
  // asks again. The core answers once its own check with the new keys is done.
  const showing = listed !== null || busy !== null
  useEffect(
    () =>
      onAgentListingForgotten((forgotten) => {
        if (forgotten !== agent) return
        setError(null)
        setListed(null)
        if (showing) settle(() => agentSettings(agent), "loading")
      }),
    [agent, showing, settle]
  )

  function load() {
    // A pick still on its way answers for both.
    if (busy) return
    const kept = keptListing(agent)
    setListed(kept ?? null)
    setError(null)
    if (kept) return
    settle(() => agentSettings(agent), "loading")
  }

  function pick(setting: string, value: string) {
    if (!listed) return
    const settings = listed.settings.map((s) =>
      s.id === setting ? { ...s, current: value } : s
    )
    setListed({ ...listed, settings })
    setError(null)
    settle(() => pickAgentSettings(agent, { setting, value }), "saving")
  }

  return { listed, busy, error, load, pick }
}
