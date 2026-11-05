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
import { ModelPicker } from "@/features/agents/model-picker"
import { SetUpButton } from "@/features/agents/set-up-button"
import { useAdapterInstall } from "@/features/agents/use-adapter-install"
import {
  checkAgentsAgain,
  isReady,
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

/** Where the agent is: its setup step, or still looking for one. */
type Phase = SetupStep | "looking"

function phaseOf(
  agents: AgentStatus[] | null,
  agent: AgentStatus | null
): Phase {
  if (agents === null) return "looking"
  return agent === null ? "missing" : setupStep(agent)
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
  onPicking,
}: {
  agents: AgentStatus[] | null
  agent: AgentStatus | null
  /** The agent and the keys are ready: the splash is done. */
  allSet: boolean
  onChoose: (id: string) => void
  /** Whether the agent's model picker is open. */
  onPicking: (open: boolean) => void
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

      <AgentCard agent={agent} phase={phase} onPicking={onPicking} />

      <div className="mt-7 flex min-h-[18px] flex-col items-center gap-3">
        {install.error && (
          <p className="text-[13px] leading-[18px] text-destructive">
            {install.error}
          </p>
        )}
        {(phase === "sign_in" ||
          phase === "unreachable" ||
          phase === "missing") && (
          <CheckAgain
            // Something to run first: an install, or the agent's own fix.
            afterCommand={
              phase === "missing" ||
              (phase === "sign_in" && !!agent?.setup?.fix)
            }
          />
        )}
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
  onPicking,
}: {
  agent: AgentStatus | null
  phase: Phase
  onPicking: (open: boolean) => void
}) {
  return (
    <SetupCard
      className="mt-7"
      tile={<AgentTile id={agent?.id ?? "claude"} />}
      name={agent?.name ?? "Claude Code"}
      status={<StatusLine tone={toneOf(phase)} text={statusOf(agent, phase)} />}
      action={<Action agent={agent} phase={phase} onPicking={onPicking} />}
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
function shortStatusOf(agent: AgentStatus, phase: Phase): string {
  switch (phase) {
    case "looking":
      return "Looking"
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

/** The card's next step, in place; a ready agent shows its model, to change if wanted. */
function Action({
  agent,
  phase,
  onPicking,
}: {
  agent: AgentStatus | null
  phase: Phase
  onPicking: (open: boolean) => void
}) {
  const primary = cn(
    CARD_BUTTON,
    "bg-primary text-primary-foreground hover:bg-primary/90"
  )
  if (phase === "connect")
    return (
      <SetUpButton size="default" className={primary}>
        Set up now
      </SetUpButton>
    )
  if ((phase === "pick" || phase === "ready") && agent)
    return (
      <ModelPicker
        // Each agent's own settings, not the last one's (`useAgentSettings`).
        key={agent.id}
        agent={agent}
        size="default"
        // A width of its own, for the model's name to fit or slide in.
        className={cn(CARD_BUTTON, "w-48")}
        onOpenChange={onPicking}
      />
    )
  if (phase === "missing")
    return (
      <CopyButton text={CLAUDE_INSTALL} className={CARD_BUTTON}>
        Copy install
      </CopyButton>
    )
  const fix = agent?.setup?.fix
  if (phase === "sign_in" && fix)
    return (
      <CopyButton text={fix} className={CARD_BUTTON}>
        Copy {fix}
      </CopyButton>
    )
  return null
}

/** After running a command in Terminal: look again. */
/** "Run it in Terminal, then check again", or just "Check again" with nothing to run. */
function CheckAgain({ afterCommand }: { afterCommand: boolean }) {
  const [checking, startChecking] = useTransition()
  return (
    <span className="flex items-center gap-1.5 text-[13px] leading-[18px] text-muted-foreground">
      {afterCommand && "Run it in Terminal, then"}
      <InlineLink
        disabled={checking}
        onClick={() => startChecking(checkAgentsAgain)}
      >
        {checking
          ? "checking..."
          : afterCommand
            ? "check again"
            : "Check again"}
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
          className="flex items-center gap-1 text-[13px] leading-[18px] text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
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
