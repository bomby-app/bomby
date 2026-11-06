import { Bot, Layers } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"

import { FieldLabel } from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { AgentLogo } from "@/features/agents/agent-logos"
import type { AgentStatus } from "@/features/agents/api"
import { isReady, useAgents } from "@/features/agents/use-agents"
import { cn } from "@/lib/utils"

import type { ProjectAgents } from "./api"
import { andList } from "./names"

/**
 * Which agents the project's calls can hand work to (Paper "Project settings · Agents"):
 * a switch, then All or the ones the user picks. All is every agent that's set up, including
 * ones added later; a pick reaches a call only once that agent is set up too. Off, the
 * project's calls talk but hand nothing off. Applies from the next call.
 */
export function ProjectAgentsField({
  agents,
  onChange,
}: {
  agents: ProjectAgents
  onChange: (agents: ProjectAgents) => void
}) {
  const { agents: known } = useAgents()
  const all = agents.only.length === 0

  function toggle(id: string) {
    const only = agents.only.includes(id)
      ? agents.only.filter((a) => a !== id)
      : [...agents.only, id]
    // Picking none left is All again.
    onChange({ ...agents, only })
  }

  const picked = (known ?? [])
    .filter((agent) => agents.only.includes(agent.id))
    .map((agent) => agent.name)

  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
          <Bot className="size-[18px]" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
          <FieldLabel htmlFor="project-agents">Agents</FieldLabel>
          <span className="text-muted-foreground">
            Let Bomby hand this project&apos;s work off.
          </span>
        </div>
        <Switch
          id="project-agents"
          checked={agents.on}
          onCheckedChange={(on) => onChange({ ...agents, on })}
        />
      </div>
      {agents.on && (
        <>
          <Separator />
          <div className="flex flex-col gap-2.5 px-4 pt-3 pb-4">
            <div className="grid grid-cols-2 gap-2">
              <Tile
                chosen={all}
                onClick={() => onChange({ ...agents, only: [] })}
                logo={<Layers />}
                name="All"
              />
              {known?.map((agent) => (
                <AgentTile
                  key={agent.id}
                  agent={agent}
                  chosen={agents.only.includes(agent.id)}
                  onClick={() => toggle(agent.id)}
                />
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              {all
                ? "All means every agent that's set up, including ones you add later."
                : `Bomby hands this project's work only to ${andList(picked)}.`}
            </p>
          </div>
        </>
      )}
    </div>
  )
}

/** One agent: a dot for whether it's set up, and where to set it up if it isn't. */
function AgentTile({
  agent,
  chosen,
  onClick,
}: {
  agent: AgentStatus
  chosen: boolean
  onClick: () => void
}) {
  const ready = isReady(agent)
  const tile = (
    <Tile
      chosen={chosen}
      onClick={onClick}
      logo={<AgentLogo id={agent.id} />}
      name={agent.name}
      muted={!ready}
      dot={ready ? "bg-primary" : "bg-claude"}
    />
  )
  if (ready) return tile
  return (
    <Tooltip>
      <TooltipTrigger asChild>{tile}</TooltipTrigger>
      <TooltipContent>
        {agent.path === null
          ? "Not installed yet, in Settings, Agents"
          : "Needs setup in Settings, Agents"}
      </TooltipContent>
    </Tooltip>
  )
}

function Tile({
  chosen,
  onClick,
  logo,
  name,
  muted = false,
  dot,
  ...props
}: {
  chosen: boolean
  onClick: () => void
  logo: ReactNode
  name: string
  /** Not set up yet: its logo and name in grey. */
  muted?: boolean
  /** The status dot's colour class, if it has one. */
  dot?: string
} & Omit<ComponentProps<"button">, "onClick" | "name">) {
  return (
    <button
      type="button"
      aria-pressed={chosen}
      onClick={onClick}
      // Tooltip's trigger passes its own props through.
      {...props}
      className={cn(
        "flex h-11 min-w-0 items-center gap-2.5 rounded-lg border bg-background px-3 text-left text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        chosen && "border-foreground ring-1 ring-foreground ring-inset",
        muted && "text-muted-foreground"
      )}
    >
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center [&_svg]:size-[18px]",
          muted && "opacity-50 grayscale"
        )}
      >
        {logo}
      </span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {dot && <span className={cn("mr-1 size-2 shrink-0 rounded-full", dot)} />}
    </button>
  )
}
