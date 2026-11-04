import { ChevronDown } from "lucide-react"
import { useState, useTransition } from "react"

import { InlineLink } from "@/components/inline-link"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { AgentLogo } from "@/features/agents/agent-logos"
import type { AgentStatus } from "@/features/agents/api"
import { CopyButton } from "@/features/agents/copy-button"
import { CLAUDE_INSTALL } from "@/features/agents/install-first-agent"
import { SetUpButton } from "@/features/agents/set-up-button"
import { useAdapterInstall } from "@/features/agents/use-adapter-install"
import { checkAgentsAgain, isReady } from "@/features/agents/use-agents"
import { cn } from "@/lib/utils"

import {
  CARD_BUTTON,
  SetupCard,
  StatusLine,
  StepHeading,
  Tile,
  type Tone,
} from "./setup-card"

/** Offered first when installed, ready or not (owner, 2026-11-05). */
const PREFERRED = ["claude", "codex"]

/**
 * The agent the splash offers: the one picked, else Claude Code, else Codex, else the first
 * that's ready, else the first found.
 */
export function firstAgent(
  agents: AgentStatus[] | null,
  chosen: string | null
): AgentStatus | null {
  const installed = agents?.filter((agent) => agent.path !== null) ?? []
  const byId = (id: string | null) => installed.find((agent) => agent.id === id)
  return (
    byId(chosen) ??
    PREFERRED.map(byId).find(Boolean) ??
    installed.find(isReady) ??
    installed[0] ??
    null
  )
}

type Phase = "looking" | "none" | "adapter" | "fix" | "ready"

function phaseOf(
  agents: AgentStatus[] | null,
  agent: AgentStatus | null
): Phase {
  if (agents === null) return "looking"
  if (agent === null || agent.path === null) return "none"
  if (agent.setup?.adapter) return "adapter"
  return isReady(agent) ? "ready" : "fix"
}

const COPY: Record<Phase, (name: string) => [string, string]> = {
  looking: () => [
    "Set up your first agent",
    "I pass what you say to a coding agent already on your Mac. Let me look for one.",
  ],
  none: () => [
    "Let's get you an agent",
    "I pass what you say to a coding agent on your Mac. Claude Code is a good first one.",
  ],
  adapter: () => [
    "Set up your first agent",
    "I pass what you say to a coding agent already on your Mac. I found one for us.",
  ],
  fix: (name) => [
    "Almost there",
    `${name} is on your Mac, but it needs one thing first.`,
  ],
  ready: (name) => [
    "You're all set",
    `I pass what you say to ${name}, already on your Mac. Let's talk.`,
  ],
}

/** The splash's agent step: the heading, the agent's card, and other agents to pick from. */
export function FirstAgent({
  agents,
  agent,
  allSet,
  onChoose,
}: {
  agents: AgentStatus[] | null
  agent: AgentStatus | null
  /** The agent and the keys are ready: the splash is done. */
  allSet: boolean
  onChoose: (id: string) => void
}) {
  const phase = phaseOf(agents, agent)
  const [title, body] =
    phase === "ready" && !allSet
      ? ["Your agent's ready", "Now your keys, and we're ready to talk."]
      : COPY[phase](agent?.name ?? "")
  const install = useAdapterInstall()
  const others = agents?.filter((other) => other.id !== agent?.id) ?? []

  return (
    <div className="flex flex-col items-center">
      <StepHeading title={title} body={body} />

      <AgentCard agent={agent} phase={phase} />

      <div className="mt-7 flex min-h-[18px] flex-col items-center gap-3">
        {install.error && (
          <p className="text-[13px] leading-[18px] text-destructive">
            {install.error}
          </p>
        )}
        {(phase === "fix" || phase === "none") && <CheckAgain />}
        {/* Another agent can always be picked, also while this one needs fixing. */}
        {others.some((other) => other.path !== null) && (
          <OtherAgents agents={others} onChoose={onChoose} />
        )}
      </div>
    </div>
  )
}

function AgentCard({
  agent,
  phase,
}: {
  agent: AgentStatus | null
  phase: Phase
}) {
  return (
    <SetupCard
      className="mt-7"
      tile={<AgentTile id={agent?.id ?? "claude"} />}
      name={agent?.name ?? "Claude Code"}
      status={<StatusLine tone={toneOf(phase)} text={statusOf(agent, phase)} />}
      action={<Action agent={agent} phase={phase} />}
    />
  )
}

/** An agent's logo on its tile: Claude in its own colours, the rest in the theme's. */
export function AgentTile({
  id,
  small = false,
}: {
  id: string
  small?: boolean
}) {
  return (
    <Tile
      small={small}
      className={
        id === "claude"
          ? "bg-[var(--agent-claude-tile)] text-[var(--agent-claude)]"
          : undefined
      }
    >
      <AgentLogo id={id} />
    </Tile>
  )
}

function toneOf(phase: Phase): Tone {
  if (phase === "looking") return "looking"
  return phase === "fix" || phase === "none" ? "todo" : "done"
}

function statusOf(agent: AgentStatus | null, phase: Phase): string {
  const setup = agent?.setup
  switch (phase) {
    case "looking":
      return "Looking on this Mac"
    case "none":
      return "Not on this Mac yet"
    case "ready":
      return ["Ready", setup?.account ?? setup?.model]
        .filter(Boolean)
        .join(" · ")
    case "fix":
      return setup?.problem ?? "Needs setting up"
    default:
      return "Found on this Mac"
  }
}

/** The same, in the list of other agents, where there's room for less. */
function shortStatusOf(agent: AgentStatus, phase: Phase): string {
  switch (phase) {
    case "none":
      return "Not on this Mac"
    case "ready":
      return "Ready"
    case "fix":
      return agent.setup?.problem ?? "Needs setting up"
    default:
      return "Needs setting up"
  }
}

function Action({ agent, phase }: { agent: AgentStatus | null; phase: Phase }) {
  if (phase === "adapter")
    return (
      <SetUpButton
        size="default"
        className={cn(
          CARD_BUTTON,
          "bg-primary text-primary-foreground hover:bg-primary/90"
        )}
      >
        Set up now
      </SetUpButton>
    )
  if (phase === "none")
    return (
      <CopyButton text={CLAUDE_INSTALL} className={CARD_BUTTON}>
        Copy install
      </CopyButton>
    )
  const fix = agent?.setup?.fix
  if (phase === "fix" && fix)
    return (
      <CopyButton text={fix} className={CARD_BUTTON}>
        Copy {fix}
      </CopyButton>
    )
  return null
}

/** After running a command in Terminal: look again. */
function CheckAgain() {
  const [checking, startChecking] = useTransition()
  return (
    <span className="flex items-center gap-1.5 text-[13px] leading-[18px] text-foreground/55">
      Run it in Terminal, then
      <InlineLink
        disabled={checking}
        onClick={() => startChecking(checkAgentsAgain)}
      >
        {checking ? "checking..." : "check again"}
      </InlineLink>
    </span>
  )
}

/** "Use Codex, OpenCode, omp or goose instead": the other agents, to pick one. */
function OtherAgents({
  agents,
  onChoose,
}: {
  agents: AgentStatus[]
  onChoose: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const names = agents.map((agent) => agent.name)
  const list =
    names.length > 1
      ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`
      : (names[0] ?? "")
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-[13px] leading-[18px] text-foreground/55 outline-none hover:text-foreground focus-visible:text-foreground"
        >
          Use {list} instead
          <ChevronDown className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-1.5" align="center">
        <ul className="flex flex-col">
          {agents.map((agent) => (
            <li key={agent.id}>
              <button
                type="button"
                disabled={agent.path === null}
                className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50"
                onClick={() => {
                  onChoose(agent.id)
                  setOpen(false)
                }}
              >
                <AgentTile id={agent.id} small />
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">{agent.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {shortStatusOf(agent, phaseOf(agents, agent))}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
