import { SquareTerminal } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { CheckAgainButton } from "@/components/check-again-button"
import { StatusRow } from "@/components/status-row"
import { Button } from "@/components/ui/button"
import { useSettingsNavigation } from "@/lib/settings-navigation"
import type { AgentStatus } from "../agents/api"
import { isReady, useAgents } from "../agents/use-agents"
import { credentialsInfo, hasGeminiKey } from "../credentials/api"
import { GeminiLogo, LiveKitLogo } from "./provider-logos"

type Keys = {
  livekit: boolean
  gemini: boolean
}

/**
 * The Setup section of the settings window: what a call needs (the user's keys and an
 * agent), each ready or a button to where it is fixed
 * (docs/decisions/users-bring-their-own-keys-and-claude.md).
 */
export function SetupSettings() {
  const { go } = useSettingsNavigation()
  const [keys, setKeys] = useState<Keys | null>(null)
  const [checkingKeys, setCheckingKeys] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const agents = useAgents()

  // Keeps the rows up while it checks again; only the first check shows Checking...
  const checkKeys = useCallback(async () => {
    setCheckingKeys(true)
    setError(null)
    try {
      const [livekit, gemini] = await Promise.all([
        credentialsInfo(),
        hasGeminiKey(),
      ])
      setKeys({ livekit: !!livekit?.hasSecret, gemini })
    } catch (e) {
      setError(String(e))
    } finally {
      setCheckingKeys(false)
    }
  }, [])

  useEffect(() => {
    void checkKeys()
  }, [checkKeys])

  const shownError = error ?? agents.error
  const agentReady = agents.agents ? agents.agents.some(isReady) : null

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        A call needs these three. Bomby uses your own accounts.
      </p>
      {shownError && <p className="text-sm text-destructive">{shownError}</p>}
      <ul className="flex flex-col divide-y rounded-lg border">
        <StatusRow
          logo={<LiveKitLogo />}
          name="LiveKit keys"
          ready={keys?.livekit}
          detail={keys?.livekit ? "Saved in your keychain." : "Not added yet."}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => go({ section: "credentials", field: "livekit" })}
            >
              Add keys
            </Button>
          }
        />
        <StatusRow
          logo={<GeminiLogo />}
          name="Gemini API key"
          ready={keys?.gemini}
          detail={keys?.gemini ? "Saved in your keychain." : "Not added yet."}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => go({ section: "credentials", field: "gemini" })}
            >
              Add key
            </Button>
          }
        />
        <StatusRow
          logo={<SquareTerminal />}
          name="Coding agent"
          ready={agentReady}
          detail={agents.agents ? agentDetail(agents.agents) : null}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => go({ section: "agents" })}
            >
              Set up
            </Button>
          }
        />
      </ul>
      <div>
        <CheckAgainButton
          checking={checkingKeys || agents.refreshing}
          disabled={keys === null || agents.agents === null}
          onClick={() => {
            void checkKeys()
            void agents.refresh()
          }}
        />
      </div>
    </div>
  )
}

/** "Claude Code and omp are ready.", or what stands in the way. */
function agentDetail(agents: AgentStatus[]): string {
  const ready = agents.filter(isReady).map((agent) => agent.name)
  if (ready.length > 0)
    return `${list(ready)} ${ready.length === 1 ? "is" : "are"} ready.`
  const installed = agents.filter((agent) => agent.path !== null)
  if (installed.length > 0)
    return `${list(installed.map((agent) => agent.name))} ${installed.length === 1 ? "needs" : "need"} signing in.`
  return "None installed yet."
}

/** "a", "a and b", "a, b and c". */
function list(names: string[]): string {
  if (names.length <= 1) return names.join("")
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
}
