import { SquareTerminal } from "lucide-react"
import { type ReactNode, useState, useTransition } from "react"

import { CheckAgainButton } from "@/components/check-again-button"
import { ErrorCard } from "@/components/error-card"
import { StatusMark, StatusRow } from "@/components/status-row"
import { Button } from "@/components/ui/button"

import { AgentLogo } from "./agent-logos"
import { AgentSetupDialog } from "./agent-setup-dialog"
import { type AgentStatus, versionNumber } from "./api"
import { InstallFirstAgent } from "./install-first-agent"
import { useAdapterInstall } from "./use-adapter-install"
import { checkAgentsAgain, isReady, useAgents } from "./use-agents"

/**
 * The Agents section of the settings window: the agents Bomby can hand work to, as the
 * core last found them on this computer (docs/decisions/detect-acp-native-agents.md), with
 * what their setup probe found (docs/decisions/check-agent-setup-with-an-acp-probe.md). The
 * core looks at launch, so the list shows at once, and again on Check again. Each installed
 * agent is set up, or changed, in the same flow (`AgentSetupDialog`). Whatever the core
 * reports is listed; a new agent needs no change here.
 */
export function AgentsSettings() {
  const { agents, error } = useAgents()
  const install = useAdapterInstall()
  const [checking, startChecking] = useTransition()
  // The agent being set up, by id, so the dialog follows the core's latest list.
  const [settingUp, setSettingUp] = useState<string | null>(null)
  const open = agents?.find((agent) => agent.id === settingUp) ?? null

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Bomby hands work to the agents you have installed. A call needs at least
        one.
      </p>
      {error && <ErrorCard message={error} />}
      {install.error && <ErrorCard message={install.error} />}
      {agents?.every((agent) => agent.path === null) ? (
        <InstallFirstAgent />
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {agents === null ? (
            <StatusRow
              logo={<SquareTerminal />}
              name="Agents"
              ready={null}
              detail={null}
            />
          ) : (
            agents.map((agent) => (
              <StatusRow
                key={agent.id}
                logo={<AgentLogo id={agent.id} />}
                name={agent.name}
                ready={isReady(agent)}
                detail={detail(agent)}
                action={action(agent, () => setSettingUp(agent.id))}
              />
            ))
          )}
        </ul>
      )}
      <div>
        <CheckAgainButton
          checking={checking}
          onClick={() => startChecking(checkAgentsAgain)}
        />
      </div>
      <AgentSetupDialog
        agent={open}
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setSettingUp(null)
        }}
      />
    </div>
  )
}

/**
 * Set up for an agent a call can't use yet, bubblegum like every button to something a call
 * still needs (docs/brand.md); Change for one that's ready.
 */
function action(agent: AgentStatus, onSetUp: () => void): ReactNode {
  if (!agent.path) return <StatusMark state="off" />
  return isReady(agent) ? (
    <Button variant="outline" size="sm" onClick={onSetUp}>
      Change
    </Button>
  ) : (
    <Button variant="claude" size="sm" onClick={onSetUp}>
      Set up
    </Button>
  )
}

function detail({ name, path, version, setUp, setup }: AgentStatus): ReactNode {
  if (!path) return `Not installed. Install ${name}, then check again.`
  if (setup?.adapter || !setUp)
    return `Found on this Mac. Set it up to use it in calls.`
  if (setup && !setup.ready) {
    const problem = setup.problem && (
      <span className="select-text">{setup.problem}. </span>
    )
    return <>Needs setup. {problem}Set up shows what to do.</>
  }
  const state =
    [setup?.account, setup?.model].filter(Boolean).join(" · ") || "Set up"
  return version ? `${state} · ${versionNumber(version)}` : state
}
