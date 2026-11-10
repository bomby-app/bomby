import { AudioLines, SquareTerminal } from "lucide-react"
import { useTransition } from "react"

import { CheckAgainButton } from "@/components/check-again-button"
import { ErrorCard } from "@/components/error-card"
import { StatusRow } from "@/components/status-row"
import { Button } from "@/components/ui/button"
import { useSettingsNavigation } from "@/lib/settings-navigation"
import { andList } from "@/lib/text"

import type { AgentStatus } from "../agents/api"
import { checkAgentsAgain, isReady, useAgents } from "../agents/use-agents"
import {
  checkKeysAgain,
  type Keys,
  useSavedKeys,
} from "../call-server/use-saved-keys"
import { PROVIDERS } from "../voice/providers"
import { LiveKitLogo } from "./provider-logos"

/**
 * The Setup section of the settings window: what a call needs (the user's keys, and an
 * agent for work), each ready or a button to where it is fixed
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
        A call needs a call server and a voice, and an agent to do the work.
        Bomby uses your own accounts.
      </p>
      {error && <ErrorCard message={error} />}
      <ul className="flex flex-col divide-y rounded-lg border">
        <StatusRow
          logo={
            <LiveKitLogo
              className={
                keys?.server === "theirs" ? "text-livekit-cloud" : undefined
              }
            />
          }
          name="Call server"
          ready={keys?.livekit}
          detail={keys ? serverDetail(keys) : null}
          action={
            <GoButton to={{ section: "call-server", field: "livekit" }}>
              Add keys
            </GoButton>
          }
        />
        <StatusRow
          logo={<VoiceLogo keys={keys} />}
          name="Voice"
          ready={keys ? keys.voiceKey : null}
          detail={keys ? voiceDetail(keys) : null}
          action={
            <GoButton to={{ section: "voice", field: "key" }}>
              {keys?.voice ? "Add key" : "Pick one"}
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

function serverDetail(keys: Keys): string {
  if (keys.server === "thisMac") return "LiveKit, on this Mac."
  return keys.theirLiveKit
    ? "Your LiveKit Cloud, its keys in your keychain."
    : "LiveKit Cloud needs its keys."
}

/** The picked provider's logo, or a plain voice mark before there's one. */
function VoiceLogo({ keys }: { keys: Keys | null }) {
  if (!keys?.voice) return <AudioLines />
  const Logo = PROVIDERS[keys.voice].logo
  return <Logo />
}

function voiceDetail(keys: Keys): string {
  if (!keys.voice) return "Pick who Bomby talks through."
  const name = PROVIDERS[keys.voice].name
  return keys.voiceKey
    ? `${name}, its key in your keychain.`
    : `${name} needs its API key.`
}

/** "Claude Code and omp are ready.", or what stands in the way. */
function agentDetail(agents: AgentStatus[]): string {
  const ready = agents.filter(isReady).map((agent) => agent.name)
  if (ready.length > 0)
    return `${andList(ready)} ${ready.length === 1 ? "is" : "are"} ready.`
  const installed = agents.filter((agent) => agent.path !== null)
  if (installed.length > 0)
    return `${andList(installed.map((agent) => agent.name))} ${installed.length === 1 ? "needs" : "need"} setting up.`
  return "None installed yet."
}
