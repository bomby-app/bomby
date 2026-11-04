import { SquareTerminal } from "lucide-react"
import { type ReactNode, useCallback, useEffect, useState } from "react"

import { StatusRow } from "@/components/status-row"
import { Button } from "@/components/ui/button"
import { AgentLogo } from "./agent-logos"
import { type AgentStatus, agentsStatus, planName, versionNumber } from "./api"
import { InstallFirstAgent } from "./install-first-agent"

/**
 * The Agents section of the settings window: the agents Bomby can hand work to, as the
 * core finds them on this computer (docs/decisions/detect-acp-native-agents.md). Whatever
 * the core reports is listed; a new agent needs no change here.
 */
export function AgentsSettings() {
  const [agents, setAgents] = useState<AgentStatus[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const check = useCallback(async () => {
    setAgents(null)
    setError(null)
    try {
      setAgents(await agentsStatus())
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => {
    void check()
  }, [check])

  if (error) return <p className="text-sm text-destructive">{error}</p>

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Bomby hands work to the agents you have installed. A call needs at least
        one.
      </p>
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
                ready={ready(agent)}
                detail={detail(agent)}
              />
            ))
          )}
        </ul>
      )}
      <div>
        <Button
          variant="outline"
          disabled={!agents}
          onClick={() => void check()}
        >
          Check again
        </Button>
      </div>
    </div>
  )
}

/** Installed, and signed in where the agent can tell us. */
function ready({ path, signIn }: AgentStatus): boolean {
  return path !== null && (signIn === null || signIn.signedIn)
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
