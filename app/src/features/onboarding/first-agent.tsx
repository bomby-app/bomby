import { ChevronDown } from "lucide-react"
import { useState, useTransition } from "react"

import { InlineLink } from "@/components/inline-link"
import { buttonVariants } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { AgentLogo } from "@/features/agents/agent-logos"
import type { AgentStatus } from "@/features/agents/api"
import { InstallButton } from "@/features/agents/install-button"
import { ModelPicker } from "@/features/agents/model-picker"
import { SetUpButton } from "@/features/agents/set-up-button"
import { useAdapterInstall } from "@/features/agents/use-adapter-install"
import {
  checkAgentsAgain,
  type SetupStep,
  setupStep,
} from "@/features/agents/use-agents"
import { cn } from "@/lib/utils"

import {
  CARD_BUTTON,
  SetupCard,
  StatusLine,
  StepHeading,
  Tile,
  type Tone,
} from "./setup-card"

/** Where the agent is: its setup step, or still looking for one. */
type Phase = SetupStep | "looking"

function phaseOf(agent: AgentStatus | null): Phase {
  return agent === null ? "looking" : setupStep(agent)
}

const COPY: Record<Phase, (name: string) => [string, string]> = {
  looking: () => [
    "Set up your first agent",
    "I pass what you say to a coding agent already on your Mac. Let me look for one.",
  ],
  missing: () => [
    "Let's get you an agent",
    "I pass what you say to a coding agent on your Mac. Claude Code is a good first one.",
  ],
  connect: () => [
    "Set up your first agent",
    "I pass what you say to a coding agent already on your Mac. I found one for us.",
  ],
  sign_in: (name) => [
    "Almost there",
    `${name} is on your Mac, but it needs one thing first.`,
  ],
  unreachable: (name) => [
    "Almost there",
    `${name} is on your Mac, but it didn't answer. Let's check again.`,
  ],
  pick: (name) => [
    "One last pick",
    `${name} is on your Mac. Pick the model it runs on, and we're set.`,
  ],
  ready: () => [
    "Your agent's ready",
    "Now your keys, and we're ready to talk.",
  ],
}

/**
 * The splash's agent step: the heading, the agent's card, what to do next, and the other
 * supported agents to pick or install. Installing and signing in stay the agent's own: the
 * card links to its install page and says whether it's ready.
 */
export function FirstAgent({
  agents,
  agent,
  onChoose,
  onLater,
}: {
  agents: AgentStatus[] | null
  agent: AgentStatus | null
  onChoose: (id: string) => void
  /** Goes on to the keys without an agent. */
  onLater: () => void
}) {
  const phase = phaseOf(agent)
  const [title, body] = COPY[phase](agent?.name ?? "")
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
        {agent && phase !== "ready" && (
          <NextSteps phase={phase} name={agent.name} onLater={onLater} />
        )}
        {others.length > 0 && (
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
      action={agent && <Action agent={agent} phase={phase} />}
    />
  )
}

/** An agent's logo on its tile: Claude in its own colours, the rest in the theme's. */
function AgentTile({ id, small = false }: { id: string; small?: boolean }) {
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
  return phase === "ready" ? "done" : "todo"
}

function statusOf(agent: AgentStatus | null, phase: Phase): string {
  const setup = agent?.setup
  switch (phase) {
    case "looking":
      return "Looking on this Mac"
    case "missing":
      return "Not on this Mac yet"
    case "ready":
      return ["Ready", setup?.account].filter(Boolean).join(" · ")
    case "sign_in":
      return setup?.problem ?? "Needs setting up"
    case "unreachable":
      return setup?.problem ?? "Didn't answer"
    case "pick":
      return "Pick its model"
    case "connect":
      return "Found on this Mac"
  }
}

/** The same, in the list of other agents, where there's room for less. */
function shortStatusOf(agent: AgentStatus): string {
  switch (setupStep(agent)) {
    case "missing":
      return "Not on this Mac"
    case "ready":
      return "Ready"
    case "sign_in":
      return agent.setup?.problem ?? "Needs setting up"
    case "unreachable":
      return "Didn't answer"
    case "pick":
      return "Pick its model"
    case "connect":
      return "Needs setting up"
  }
}

const PRIMARY = cn(
  CARD_BUTTON,
  "bg-primary text-primary-foreground hover:bg-primary/90"
)

/** The card's next step, in place; a ready agent shows its model, to change if wanted. */
function Action({ agent, phase }: { agent: AgentStatus; phase: Phase }) {
  switch (phase) {
    case "missing":
      return <InstallButton agent={agent} size="default" className={PRIMARY} />
    case "connect":
      return (
        <SetUpButton size="default" className={PRIMARY}>
          Set up now
        </SetUpButton>
      )
    case "pick":
    case "ready":
      return (
        <ModelPicker
          // Each agent's own settings, not the last one's (`useAgentSettings`).
          key={agent.id}
          agent={agent}
          size="default"
          // A width of its own, for the model's name to fit or slide in.
          className={cn(CARD_BUTTON, "w-48")}
        />
      )
    case "looking":
    case "sign_in":
    case "unreachable":
      return null
  }
}

/**
 * One line under the card: how to go on from here ("Already installed one? Check again"),
 * and always Set up later.
 */
function NextSteps({
  phase,
  name,
  onLater,
}: {
  phase: Phase
  name: string
  onLater: () => void
}) {
  const [checking, startChecking] = useTransition()
  const checkAgain = (label: string, busy: string) => (
    <InlineLink
      disabled={checking}
      onClick={() => startChecking(checkAgentsAgain)}
    >
      {checking ? busy : label}
    </InlineLink>
  )
  const lead =
    phase === "missing" ? (
      <>Already installed one? {checkAgain("Check again", "Checking...")}</>
    ) : phase === "sign_in" ? (
      <>
        Set it up in {name}, then {checkAgain("check again", "checking...")}
      </>
    ) : phase === "unreachable" ? (
      checkAgain("Check again", "Checking...")
    ) : null

  return (
    <span className="flex items-center gap-1.5 text-[13px] leading-[18px] text-muted-foreground">
      {lead && (
        <>
          {lead}
          <span aria-hidden="true">·</span>
        </>
      )}
      <InlineLink onClick={onLater}>Set up later</InlineLink>
    </span>
  )
}

/**
 * "Other supported agents": every other agent Bomby supports, each to pick when it's on
 * this Mac, or to install from its own page when it isn't.
 */
function OtherAgents({
  agents,
  onChoose,
}: {
  agents: AgentStatus[]
  onChoose: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-[13px] leading-[18px] text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
        >
          Other supported agents
          <ChevronDown className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-1.5" align="center">
        <ul className="flex flex-col gap-0.5">
          {agents.map((agent) => (
            <li key={agent.id}>
              {agent.path === null ? (
                <div className="flex items-center gap-3 px-2 py-1.5">
                  <OtherAgentSummary agent={agent} />
                  <InstallButton agent={agent} variant="outline" size="sm" />
                </div>
              ) : (
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent"
                  onClick={() => {
                    onChoose(agent.id)
                    setOpen(false)
                  }}
                >
                  <OtherAgentSummary agent={agent} />
                  <span
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
                  >
                    Use
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function OtherAgentSummary({ agent }: { agent: AgentStatus }) {
  return (
    <>
      <AgentTile id={agent.id} small />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{agent.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {shortStatusOf(agent)}
        </span>
      </span>
    </>
  )
}
