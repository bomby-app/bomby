import { SquareTerminal } from "lucide-react"
import { type ReactNode, useState, useTransition } from "react"

import { CheckAgainButton } from "@/components/check-again-button"
import { ErrorCard } from "@/components/error-card"
import { StatusMark, StatusRow } from "@/components/status-row"
import { Button } from "@/components/ui/button"

import { AgentLogo } from "./agent-logos"
import { AgentSetupDialog } from "./agent-setup-dialog"
import { type AgentStatus, versionNumber } from "./api"
import { CopyButton } from "./copy-button"
import { InstallFirstAgent } from "./install-first-agent"
import { SetUpButton } from "./set-up-button"
import { useAdapterInstall } from "./use-adapter-install"
import { checkAgentsAgain, isReady, setupStep, useAgents } from "./use-agents"

/**
 * The Agents section of the settings window: the agents Bomby can hand work to, as the
 * core last found them on this computer (docs/decisions/detect-acp-native-agents.md), with
 * what their setup probe found (docs/decisions/check-agent-setup-with-an-acp-probe.md). The
 * core looks at launch, so the list shows at once, and again on Check again. Each row shows
 * the agent's next setup step (`setupStep`). Whatever the core reports is listed; a new
 * agent needs no change here.
 */
export function AgentsSettings() {
  const { agents, error } = useAgents()
  const install = useAdapterInstall()
  const [checking, startChecking] = useTransition()
  // The agent whose model is being picked, by id, so the dialog follows the latest list.
  const [picking, setPicking] = useState<string | null>(null)
  const open = agents?.find((agent) => agent.id === picking) ?? null

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
                action={action(agent, () => setPicking(agent.id))}
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
          if (!next) setPicking(null)
        }}
      />
    </div>
  )
}

/** The agent's next step, in place: connect, the command to run, or picking its model. */
function action(agent: AgentStatus, onPick: () => void): ReactNode {
  switch (setupStep(agent)) {
    case "missing":
      return <StatusMark state="off" />
    case "connect":
      return <SetUpButton />
    case "sign-in":
      return agent.setup?.fix ? (
        <CopyButton text={agent.setup.fix} variant="outline" size="sm">
          Copy command
        </CopyButton>
      ) : undefined
    case "pick":
      // Bubblegum, like every button to something a call still needs (docs/brand.md).
      return (
        <Button variant="claude" size="sm" onClick={onPick}>
          Pick model
        </Button>
      )
    case "ready":
      return (
        <Button variant="outline" size="sm" onClick={onPick}>
          Change
        </Button>
      )
  }
}

function detail(agent: AgentStatus): ReactNode {
  const { name, version, setup } = agent
  switch (setupStep(agent)) {
    case "missing":
      return `Not installed. Install ${name}, then check again.`
    case "connect":
      return `Found on this Mac. Set it up to use it in calls.`
    case "sign-in": {
      const problem = setup?.problem && (
        <span className="select-text">{setup.problem}. </span>
      )
      return setup?.fix ? (
        <>
          Needs setup. {problem}Run{" "}
          <code className="font-mono text-xs select-text">{setup.fix}</code> in
          Terminal, then check again.
        </>
      ) : (
        <>
          Needs setup. {problem}Set it up in {name}, then check again.
        </>
      )
    }
    case "pick":
      return setup?.choiceGone
        ? `${setup.problem ?? "Its model isn't offered any more"}. Pick again.`
        : `Found on this Mac. Pick its model to use it in calls.`
    case "ready": {
      const state =
        [setup?.account, setup?.model].filter(Boolean).join(" · ") || "Set up"
      return version ? `${state} · ${versionNumber(version)}` : state
    }
  }
}
