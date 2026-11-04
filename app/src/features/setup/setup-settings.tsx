import { SquareTerminal } from "lucide-react"
import { Suspense, use, useState, useTransition } from "react"

import { CheckAgainButton } from "@/components/check-again-button"
import { StatusRow } from "@/components/status-row"
import { Button } from "@/components/ui/button"
import { useSettingsNavigation } from "@/lib/settings-navigation"

import type { AgentStatus } from "../agents/api"
import { checkAgentsAgain, isReady, useAgents } from "../agents/use-agents"
import { credentialsInfo, hasGeminiKey } from "../credentials/api"
import { GeminiLogo, LiveKitLogo } from "./provider-logos"

/** Which keys are saved, or why the keychain couldn't say. */
type Keys = { livekit: boolean; gemini: boolean } | { error: string }

/** Never rejects, so the rows can show a failure themselves. */
async function loadKeys(): Promise<Keys> {
  try {
    const [livekit, gemini] = await Promise.all([
      credentialsInfo(),
      hasGeminiKey(),
    ])
    return { livekit: !!livekit?.hasSecret, gemini }
  } catch (e) {
    return { error: String(e) }
  }
}

/**
 * The Setup section of the settings window: what a call needs (the user's keys and an
 * agent), each ready or a button to where it is fixed
 * (docs/decisions/users-bring-their-own-keys-and-claude.md).
 */
export function SetupSettings() {
  // Read once when the section opens; Check again swaps in a new read inside a transition,
  // so the rows stay up until it answers.
  const [keys, setKeys] = useState(loadKeys)
  const [checking, startChecking] = useTransition()
  const { agents, error } = useAgents()

  function checkAgain() {
    startChecking(async () => {
      setKeys(loadKeys())
      await checkAgentsAgain()
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        A call needs these three. Bomby uses your own accounts.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ul className="flex flex-col divide-y rounded-lg border">
        <Suspense fallback={<KeyRows keys={null} />}>
          <SavedKeyRows keys={keys} />
        </Suspense>
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
          disabled={agents === null}
          onClick={checkAgain}
        />
      </div>
    </div>
  )
}

function SavedKeyRows({ keys }: { keys: Promise<Keys> }) {
  return <KeyRows keys={use(keys)} />
}

/** The LiveKit and Gemini rows; `keys` null while the keychain is read. */
function KeyRows({ keys }: { keys: Keys | null }) {
  if (keys && "error" in keys)
    return <li className="px-3 py-3 text-sm text-destructive">{keys.error}</li>
  return (
    <>
      <StatusRow
        logo={<LiveKitLogo />}
        name="LiveKit keys"
        ready={keys?.livekit}
        detail={keys?.livekit ? "Saved in your keychain." : "Not added yet."}
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
    </>
  )
}

/** A row's way to where its item is fixed. */
function GoButton({
  to,
  children,
}: {
  to: { section: string; field?: string }
  children: string
}) {
  const { go } = useSettingsNavigation()
  return (
    <Button variant="outline" size="sm" onClick={() => go(to)}>
      {children}
    </Button>
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
