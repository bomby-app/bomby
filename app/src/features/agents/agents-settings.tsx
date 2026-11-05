import { SquareTerminal } from "lucide-react"
import { type ReactNode, useTransition } from "react"

import { CheckAgainButton } from "@/components/check-again-button"
import { ErrorCard } from "@/components/error-card"
import { StatusMark, StatusRow } from "@/components/status-row"

import { AgentLogo } from "./agent-logos"
import { type AgentStatus, versionNumber } from "./api"
import { CopyButton } from "./copy-button"
import { InstallFirstAgent } from "./install-first-agent"
import { ModelPicker, skippedNote } from "./model-picker"
import { SetUpButton } from "./set-up-button"
import { useAdapterInstall } from "./use-adapter-install"
import { checkAgentsAgain, isReady, setupStep, useAgents } from "./use-agents"

/**
 * The Agents section of the settings window: the agents Bomby can hand work to, as the
 * core last found them on this computer (docs/decisions/detect-acp-native-agents.md), with
 * what their setup probe found (docs/decisions/check-agent-setup-with-an-acp-probe.md). The
 * core looks at launch, so the list shows at once, and again on Check again. Each row shows
 * what the agent needs (`setupStep`), or, once it's ready, the model it runs on, to change
 * if wanted. Whatever the core reports is listed; a new agent needs no change here.
 */
export function AgentsSettings() {
  const { agents, error } = useAgents()
  const install = useAdapterInstall()
  const [checking, startChecking] = useTransition()

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
                action={action(agent)}
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
    </div>
  )
}

/** The agent's next step, in place; a ready one shows its model, to change if wanted. */
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
      return undefined
    case "pick":
    case "ready":
      return <ModelPicker agent={agent} />
  }
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
    case "unreachable":
      return `${setup?.problem ?? "It didn't answer"}. Check again in a moment.`
    case "pick":
      return setup?.skipped.length
        ? `${skippedNote(setup.skipped[0], name)} Calls use it once its model is picked.`
        : `Found on this Mac. Pick its model to use it in calls.`
    case "ready": {
      if (setup?.skipped.length) return skippedNote(setup.skipped[0], name)
      const state = [setup?.account, version && versionNumber(version)]
        .filter(Boolean)
        .join(" · ")
      return state || "Ready"
    }
  }
}
