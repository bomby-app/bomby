import { ChevronDown } from "lucide-react"
import type { ComponentProps } from "react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

import type { AgentStatus } from "./api"
import { ModelSettings } from "./model-settings"
import { SlidingName } from "./sliding-name"
import { useAgentSettings } from "./use-agent-settings"
import { setupStep } from "./use-agents"

/**
 * The model an agent runs on, as a button that opens its settings, for the splash's agent
 * card (docs/decisions/pick-agent-settings-like-buzz-and-zed.md); Settings, Agents opens
 * the same settings in the agent's row. Each pick is saved once the agent has taken it.
 * Picking is optional, unless the agent's harness requires it (`model_selection_required`).
 * Give it a `key` of the agent's id (`useAgentSettings`).
 */
export function ModelPicker({
  agent,
  onOpenChange,
  className,
  ...props
}: {
  agent: AgentStatus
  /** Whether it's open, for a screen that would move on while it is (the splash). */
  onOpenChange?: (open: boolean) => void
} & Omit<ComponentProps<typeof Button>, "onClick">) {
  const settings = useAgentSettings(agent.id)
  // Bubblegum, like everything a call still needs (docs/brand.md).
  const required = setupStep(agent) === "pick"
  return (
    <Popover
      onOpenChange={(open) => {
        if (open) settings.load()
        onOpenChange?.(open)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant={required ? "claude" : "outline"}
          // A long model name slides to its end on hover (`SlidingName`).
          data-sliding-names
          className={cn("justify-between", className)}
          {...props}
        >
          <SlidingName name={required ? "Pick a model" : modelName(agent)} />
          <ChevronDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <ModelSettings name={agent.name} settings={settings} />
      </PopoverContent>
    </Popover>
  )
}

/** The model `agent` runs on, by its name, or how it's chosen when that isn't known yet. */
export function modelName(agent: AgentStatus): string {
  return agent.setup?.model ?? `${agent.name}'s own choice`
}
