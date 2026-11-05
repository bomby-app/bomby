import { SquareTerminal } from "lucide-react"
import { type ReactNode, useState, useTransition } from "react"

import { CheckAgainButton } from "@/components/check-again-button"
import { ErrorCard } from "@/components/error-card"
import { StatusMark, StatusRow } from "@/components/status-row"

import { AgentLogo } from "./agent-logos"
import { type AgentStatus, sentence, versionNumber } from "./api"
import { CopyButton } from "./copy-button"
import { InstallFirstAgent } from "./install-first-agent"
import { modelName } from "./model-picker"
import { ModelSettings, skippedNote } from "./model-settings"
import { SetUpButton } from "./set-up-button"
import { useAdapterInstall } from "./use-adapter-install"
import { forgetListedSettings, useAgentSettings } from "./use-agent-settings"
import { checkAgentsAgain, isReady, setupStep, useAgents } from "./use-agents"

/**
 * The Agents section of the settings window: the agents Bomby can hand work to, as the
 * core last found them on this computer (docs/decisions/detect-acp-native-agents.md), with
 * what their setup probe found (docs/decisions/check-agent-setup-with-an-acp-probe.md). The
 * core looks at launch, so the list shows at once, and again on Check again. Each row shows
 * what the agent needs (`setupStep`), or, once it's ready, the model it runs on, which opens
 * the row to change it. Whatever the core reports is listed; a new agent needs no change here.
 */
export function AgentsSettings() {
  const { agents, error } = useAgents()
  const install = useAdapterInstall()
  const [checking, startChecking] = useTransition()
  const [openId, setOpenId] = useState<string | null>(null)

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
        <ul className="flex flex-col divide-y overflow-hidden rounded-lg border">
          {agents === null ? (
            <StatusRow
              logo={<SquareTerminal />}
              name="Agents"
              ready={null}
              detail={null}
            />
          ) : (
            agents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                open={openId === agent.id}
                onOpenChange={(open) => setOpenId(open ? agent.id : null)}
              />
            ))
          )}
        </ul>
      )}
      <div>
        <CheckAgainButton
          checking={checking}
          onClick={() =>
            startChecking(() => {
              forgetListedSettings()
              return checkAgentsAgain()
            })
          }
          label="Refresh models"
          checkingLabel="Refreshing..."
        />
      </div>
    </div>
  )
}

/** What the agent needs next, in its mark's place until it's ready. */
function action(agent: AgentStatus): ReactNode {
  switch (setupStep(agent)) {
    case "missing":
      return <StatusMark state="off" />
    case "connect":
      return <SetUpButton />
    case "sign_in":
      return agent.setup?.fix ? (
        <CopyButton text={agent.setup.fix} variant="outline" size="sm">
          Copy command
        </CopyButton>
      ) : undefined
    case "unreachable":
    case "pick":
    case "ready":
      return undefined
  }
}

/**
 * One agent: what it needs, or once it's set up (or waiting for its model), a row that opens
 * on its model and effort, to change at any time. The same row through a pick, so it stays
 * open for the effort.
 */
function AgentRow({
  agent,
  open,
  onOpenChange,
}: {
  agent: AgentStatus
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const settings = useAgentSettings(agent.id)
  const step = setupStep(agent)
  const pickable = step === "pick" || step === "ready"
  return (
    <StatusRow
      logo={<AgentLogo id={agent.id} />}
      name={agent.name}
      ready={isReady(agent)}
      detail={detail(agent)}
      action={action(agent)}
      expand={
        pickable
          ? {
              open,
              onOpenChange: (next) => {
                if (next) settings.load()
                onOpenChange(next)
              },
              content: <ModelSettings name={agent.name} settings={settings} />,
            }
          : undefined
      }
    />
  )
}

function detail(agent: AgentStatus): ReactNode {
  const { name, version, setup } = agent
  switch (setupStep(agent)) {
    case "missing":
      return `Not installed. Install ${name}, then check again.`
    case "connect":
      return `Found on this Mac. Set it up to use it in calls.`
    case "sign_in": {
      const problem = setup?.problem && (
        <span className="select-text">{sentence(setup.problem)} </span>
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
    case "unreachable":
      return `${sentence(setup?.problem ?? "It didn't answer")} Check again in a moment.`
    case "pick":
      return setup?.skipped.length
        ? `${skippedNote(setup.skipped[0], name)} Calls use it once its model is picked.`
        : `Found on this Mac. Pick its model to use it in calls.`
    case "ready": {
      if (setup?.skipped.length) return skippedNote(setup.skipped[0], name)
      return [
        modelName(agent),
        setup?.account,
        version && versionNumber(version),
      ]
        .filter(Boolean)
        .join(" · ")
    }
  }
}
