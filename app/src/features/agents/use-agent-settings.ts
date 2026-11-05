import { useState } from "react"

import { agentSettings, type Listed, pickAgentSettings } from "./api"

/**
 * Each agent's last answer: asking takes seconds (the agent starts), so it's asked once and
 * kept, kept up to date by every pick, until the user refreshes (`forgetListedSettings`).
 */
const lastListed = new Map<string, Listed>()

/** Forgets every agent's settings, so each is asked again when next opened (Refresh models). */
export function forgetListedSettings(): void {
  lastListed.clear()
}

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
    () => lastListed.get(agent) ?? null
  )
  const [busy, setBusy] = useState<AgentSettings["busy"]>(null)
  const [error, setError] = useState<string | null>(null)

  function shown(next: Listed) {
    lastListed.set(agent, next)
    setListed(next)
    setError(null)
    setBusy(null)
  }

  function failed(e: unknown) {
    // Back to what the agent last confirmed, not the pick that didn't save.
    setListed(lastListed.get(agent) ?? null)
    setError(String(e))
    setBusy(null)
  }

  function load() {
    // A pick still on its way answers for both.
    if (busy) return
    const kept = lastListed.get(agent)
    setListed(kept ?? null)
    setError(null)
    if (kept) return
    setBusy("loading")
    agentSettings(agent).then(shown, failed)
  }

  function pick(setting: string, value: string) {
    if (!listed) return
    const settings = listed.settings.map((s) =>
      s.id === setting ? { ...s, current: value } : s
    )
    setListed({ ...listed, settings })
    setBusy("saving")
    setError(null)
    pickAgentSettings(agent, { setting, value }).then(shown, failed)
  }

  return { listed, busy, error, load, pick }
}
