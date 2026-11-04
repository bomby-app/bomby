import { SquareTerminal } from "lucide-react"
import { type ReactNode, useTransition } from "react"

import { CheckAgainButton } from "@/components/check-again-button"
import { StatusMark, StatusRow } from "@/components/status-row"

import { AgentLogo } from "./agent-logos"
import { type AgentStatus, planName, versionNumber } from "./api"
import { CopyButton } from "./copy-button"
import { InstallFirstAgent } from "./install-first-agent"
import { checkAgentsAgain, isReady, useAgents } from "./use-agents"

/**
 * The Agents section of the settings window: the agents Bomby can hand work to, as the
 * core last found them on this computer (docs/decisions/detect-acp-native-agents.md). The
 * core looks at launch and again when Settings opens, so the list shows at once. Whatever
 * the core reports is listed; a new agent needs no change here.
 */
export function AgentsSettings() {
  const { agents, error } = useAgents()
  const [checking, startChecking] = useTransition()

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Bomby hands work to the agents you have installed. A call needs at least
        one.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
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

/** What to do about an agent that isn't ready: sign in, or nothing for an optional one. */
function action({ path, signIn }: AgentStatus): ReactNode {
  if (!path) return <StatusMark state="off" />
  if (signIn && !signIn.signedIn)
    return (
      <CopyButton text={signIn.login} variant="outline" size="sm">
        Copy command
      </CopyButton>
    )
  return undefined
}

function detail({ name, path, version, signIn }: AgentStatus): ReactNode {
  if (!path) return `Not installed. Install ${name}, then check again.`
  const number = version ? versionNumber(version) : null
  if (signIn && !signIn.signedIn)
    return (
      <>
        Not signed in. Run{" "}
        <code className="font-mono text-xs select-text">{signIn.login}</code> in
        Terminal, then check again.
      </>
    )
  const state = signIn?.plan
    ? `Signed in, ${planName(signIn.plan)}`
    : signIn
      ? "Signed in"
      : "Installed"
  return number ? `${state} · ${number}` : state
}
