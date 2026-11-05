import { SquareTerminal } from "lucide-react"
import { useTransition } from "react"

import { CheckAgainButton } from "@/components/check-again-button"
import { ErrorCard } from "@/components/error-card"
import { StatusRow } from "@/components/status-row"
import { Button } from "@/components/ui/button"
import { useSettingsNavigation } from "@/lib/settings-navigation"

import type { AgentStatus } from "../agents/api"
import { checkAgentsAgain, isReady, useAgents } from "../agents/use-agents"
import {
  checkKeysAgain,
  type Keys,
  useSavedKeys,
} from "../credentials/use-saved-keys"
import { GeminiLogo, LiveKitLogo } from "./provider-logos"

/**
 * The Setup section of the settings window: what a call needs (the user's keys and an
 * agent), each ready or a button to where it is fixed
 * (docs/decisions/users-bring-their-own-keys-and-claude.md). Both come from stores the
 * page keeps, so the rows show at once each time the section opens.
 */
export function SetupSettings() {
  const { keys, error: keysError } = useSavedKeys()
  const { agents, error: agentsError } = useAgents()
  const [checking, startChecking] = useTransition()
  const error = keysError ?? agentsError

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        A call needs these three. Bomby uses your own accounts.
      </p>
      {error && <ErrorCard message={error} />}
      <ul className="flex flex-col divide-y rounded-lg border">
        <StatusRow
          logo={<LiveKitLogo />}
          name="LiveKit"
          ready={keys?.livekit}
          detail={keys ? livekitDetail(keys) : null}
          action={
            <GoButton to={{ section: "credentials", field: "livekit" }}>
              Add keys
            </GoButton>
          }
        />
        <StatusRow
          logo={<GeminiLogo />}
          name="Gemini API key"
          ready={keys?.gemini}
          detail={keys?.gemini ? "Saved in your keychain." : "Not added yet."}
          action={
            <GoButton to={{ section: "credentials", field: "gemini" }}>
              Add key
            </GoButton>
          }
        />
        <StatusRow
          logo={<SquareTerminal />}
          name="Coding agent"
          ready={agents ? agents.some(isReady) : null}
          detail={agents ? agentDetail(agents) : null}
          action={<GoButton to={{ section: "agents" }}>Set up</GoButton>}
        />
      </ul>
      <div>
        <CheckAgainButton
          checking={checking}
          onClick={() =>
            startChecking(async () => {
              await Promise.all([checkKeysAgain(), checkAgentsAgain()])
            })
          }
        />
      </div>
    </div>
  )
}

/** A row's way to where its item is fixed, in bubblegum: something a call still needs. */
function GoButton({
  to,
  children,
}: {
  to: { section: string; field?: string }
  children: string
}) {
  const { go } = useSettingsNavigation()
  return (
    <Button
      size="sm"
      // Bubblegum marks what is missing (docs/brand.md).
      variant="claude"
      onClick={() => go(to)}
    >
      {children}
    </Button>
  )
}

/** Where calls' LiveKit runs, or what it still needs. */
function livekitDetail(keys: Keys): string {
  if (keys.server === "thisMac") return "Runs on this Mac."
  return keys.theirLiveKit
    ? "Your keys, saved in your keychain."
    : "Not added yet."
}

/** "Claude Code and omp are ready.", or what stands in the way. */
function agentDetail(agents: AgentStatus[]): string {
  const ready = agents.filter(isReady).map((agent) => agent.name)
  if (ready.length > 0)
    return `${list(ready)} ${ready.length === 1 ? "is" : "are"} ready.`
  const installed = agents.filter((agent) => agent.path !== null)
  if (installed.length > 0)
    return `${list(installed.map((agent) => agent.name))} ${installed.length === 1 ? "needs" : "need"} setting up.`
  return "None installed yet."
}

/** "a", "a and b", "a, b and c". */
function list(names: string[]): string {
  if (names.length <= 1) return names.join("")
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
}
