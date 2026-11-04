import { ChevronDown, LoaderCircle } from "lucide-react"
import { useState, useTransition } from "react"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { AgentLogo } from "@/features/agents/agent-logos"
import type { AgentStatus } from "@/features/agents/api"
import { CopyButton } from "@/features/agents/copy-button"
import { SetUpButton } from "@/features/agents/set-up-button"
import { useAdapterInstall } from "@/features/agents/use-adapter-install"
import { checkAgentsAgain, isReady } from "@/features/agents/use-agents"
import { cn } from "@/lib/utils"

// Claude Code's own installer (claude.ai/install.sh), for a Mac with no agent yet.
const INSTALL = "curl -fsSL https://claude.ai/install.sh | bash"

/** The agent the splash offers: the one picked, else a ready one, else the first found. */
export function firstAgent(
  agents: AgentStatus[] | null,
  chosen: string | null
): AgentStatus | null {
  const installed = agents?.filter((agent) => agent.path !== null) ?? []
  return (
    installed.find((agent) => agent.id === chosen) ??
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
  if (agent === null) return "none"
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
    "Your agent's ready",
    `I pass what you say to ${name}, already on your Mac. Let's go.`,
  ],
}

/** The splash's last step: the heading, the agent's card, and other agents to pick from. */
export function FirstAgent({
  agents,
  agent,
  onChoose,
}: {
  agents: AgentStatus[] | null
  agent: AgentStatus | null
  onChoose: (id: string) => void
}) {
  const phase = phaseOf(agents, agent)
  const [title, body] = COPY[phase](agent?.name ?? "")
  const install = useAdapterInstall()
  const others = agents?.filter((other) => other.id !== agent?.id) ?? []

  return (
    <div className="mt-2.5 flex flex-col items-center">
      <h1 className="pt-1.5 font-heading text-[34px] leading-[38px] font-bold tracking-[-0.03em]">
        {title}
      </h1>
      <p className="mt-2.5 w-[400px] text-center text-[15px] leading-[22px] text-foreground/60">
        {body}
      </p>

      <AgentCard agent={agent} phase={phase} />

      <div className="mt-7 flex min-h-[18px] items-center">
        {install.error ? (
          <p className="text-[13px] leading-[18px] text-destructive">
            {install.error}
          </p>
        ) : phase === "fix" || phase === "none" ? (
          <CheckAgain />
        ) : (
          others.some((other) => other.path !== null) && (
            <OtherAgents agents={others} onChoose={onChoose} />
          )
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
  const id = agent?.id ?? "claude"
  return (
    <div className="mt-7 flex w-[440px] items-center gap-4 rounded-[18px] border bg-card p-4 shadow-[0_1px_2px_rgb(18_18_18/0.04),0_12px_32px_-12px_rgb(18_18_18/0.12)] dark:shadow-[0_12px_32px_-12px_rgb(0_0_0/0.6)]">
      <AgentTile id={id} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-base leading-5 font-semibold">
          {agent?.name ?? "Claude Code"}
        </span>
        <Status agent={agent} phase={phase} />
      </div>
      <Action agent={agent} phase={phase} />
    </div>
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
    <span
      className={cn(
        "flex shrink-0 items-center justify-center",
        small
          ? "size-8 rounded-[9px] [&_svg]:size-[18px]"
          : "size-14 rounded-[14px] [&_svg]:size-[30px]",
        id === "claude"
          ? "bg-[var(--agent-claude-tile)] text-[var(--agent-claude)]"
          : "bg-muted text-foreground"
      )}
    >
      <AgentLogo id={id} />
    </span>
  )
}

function Status({ agent, phase }: { agent: AgentStatus | null; phase: Phase }) {
  const setup = agent?.setup
  const text =
    phase === "looking"
      ? "Looking on this Mac"
      : phase === "none"
        ? "Not on this Mac yet"
        : phase === "ready"
          ? ["Ready", setup?.account ?? setup?.model]
              .filter(Boolean)
              .join(" · ")
          : phase === "fix"
            ? (setup?.problem ?? "Needs setting up")
            : "Found on this Mac"
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {phase === "looking" ? (
        <LoaderCircle className="size-3 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            phase === "fix" || phase === "none" ? "bg-claude" : "bg-primary"
          )}
        />
      )}
      <span
        title={text}
        className="truncate font-mono text-xs leading-4 text-foreground/55"
      >
        {text}
      </span>
    </span>
  )
}

// Paper's "Set up now": ink with highlighter text in light, the reverse in dark.
const BIG =
  "h-auto shrink-0 rounded-[12px] px-[18px] py-[11px] text-sm leading-[18px] font-semibold"

function Action({ agent, phase }: { agent: AgentStatus | null; phase: Phase }) {
  if (phase === "adapter")
    return (
      <SetUpButton
        size="default"
        className={cn(
          BIG,
          "bg-primary text-primary-foreground hover:bg-primary/90"
        )}
      >
        Set up now
      </SetUpButton>
    )
  if (phase === "none")
    return (
      <CopyButton text={INSTALL} className={BIG}>
        Copy install
      </CopyButton>
    )
  const fix = agent?.setup?.fix
  if (phase === "fix" && fix)
    return (
      <CopyButton text={fix} className={BIG}>
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
      <button
        type="button"
        disabled={checking}
        className="font-medium text-foreground underline decoration-highlighter decoration-[3px] underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        onClick={() => startChecking(checkAgentsAgain)}
      >
        {checking ? "checking..." : "check again"}
      </button>
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
                    {agent.path === null
                      ? "Not on this Mac"
                      : agent.setup?.adapter
                        ? "Needs setting up"
                        : isReady(agent)
                          ? "Ready"
                          : (agent.setup?.problem ?? "Needs setting up")}
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
