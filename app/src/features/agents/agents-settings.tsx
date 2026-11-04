import { SquareTerminal } from "lucide-react"
import { type ReactNode, useTransition } from "react"

import { CheckAgainButton } from "@/components/check-again-button"
import { StatusMark, StatusRow } from "@/components/status-row"

import { AgentLogo } from "./agent-logos"
import { type AgentStatus, versionNumber } from "./api"
import { CopyButton } from "./copy-button"
import { InstallFirstAgent } from "./install-first-agent"
import { SetUpButton } from "./set-up-button"
import { useAdapterInstall } from "./use-adapter-install"
import { checkAgentsAgain, isReady, useAgents } from "./use-agents"

/**
 * The Agents section of the settings window: the agents Bomby can hand work to, as the
 * core last found them on this computer (docs/decisions/detect-acp-native-agents.md), with
 * what their setup probe found (docs/decisions/check-agent-setup-with-an-acp-probe.md). The
 * core looks at launch, so the list shows at once, and again on Check again. Whatever
 * the core reports is listed; a new agent needs no change here.
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
      {error && <p className="text-sm text-destructive">{error}</p>}
      {install.error && (
        <p className="text-sm text-destructive">{install.error}</p>
      )}
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

/**
 * What to do about an agent that isn't ready: install its adapter, or the command that sets
 * it up, if it has one.
 */
function action({ path, setup }: AgentStatus): ReactNode {
  if (!path) return <StatusMark state="off" />
  if (setup?.adapter) return <SetUpButton />
  if (setup && !setup.ready && setup.fix)
    return (
      <CopyButton text={setup.fix} variant="outline" size="sm">
        Copy command
      </CopyButton>
    )
  return undefined
}

function detail({ name, path, version, setup }: AgentStatus): ReactNode {
  if (!path) return `Not installed. Install ${name}, then check again.`
  if (setup?.adapter)
    return `Found on this Mac. Set up connects Bomby to ${name}.`
  if (setup && !setup.ready) {
    const problem = setup.problem && (
      <span className="select-text">{setup.problem}. </span>
    )
    return setup.fix ? (
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
  const state =
    [setup?.account, setup?.model].filter(Boolean).join(" · ") || "Installed"
  return version ? `${state} · ${versionNumber(version)}` : state
}
