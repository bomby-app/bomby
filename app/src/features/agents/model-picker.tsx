import { ChevronDown, LoaderCircle } from "lucide-react"
import { type ComponentProps, useState } from "react"

import { Button } from "@/components/ui/button"
import { FieldError, FieldGroup } from "@/components/ui/field"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

import {
  type AgentStatus,
  agentSettings,
  pickAgentSettings,
  type Setup,
} from "./api"
import { SettingField } from "./setting-field"
import { setupStep } from "./use-agents"

/**
 * The model an agent runs on in calls, and a way to change it, like Buzz's model picker
 * (docs/decisions/pick-agent-settings-like-buzz-and-zed.md): the button names the model;
 * opening it asks the agent what it offers, and each pick is saved at once. Picking is
 * optional; an agent without picks runs on its own defaults.
 */
export function ModelPicker({
  agent,
  ...props
}: { agent: AgentStatus } & Omit<ComponentProps<typeof Button>, "onClick">) {
  const [offer, setOffer] = useState<Setup | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function shown(next: Setup) {
    setOffer(next)
    setError(null)
    setBusy(false)
  }

  function failed(e: unknown) {
    setError(String(e))
    setBusy(false)
  }

  function open() {
    setBusy(true)
    setError(null)
    agentSettings(agent.id).then(shown, failed)
  }

  /** A pick for the setting at `index`; the ones after it go back to what the agent offers. */
  function pick(index: number, value: string) {
    if (!offer) return
    const settings = offer.settings.map((setting, i) =>
      i === index ? { ...setting, current: value } : setting
    )
    // Shown at once; the agent's answer follows, with anything the pick changed.
    setOffer({ ...offer, settings })
    setBusy(true)
    const choices = settings
      .slice(0, index + 1)
      .map((s) => ({ setting: s.id, value: s.current }))
    pickAgentSettings(agent.id, choices).then(shown, failed)
  }

  // An agent that must have its model picked asks for it, in bubblegum like everything a
  // call still needs (docs/brand.md).
  const required = setupStep(agent) === "pick"
  const label = required
    ? "Pick its model"
    : (agent.setup?.model ?? "Its default model")
  return (
    <Popover onOpenChange={(next) => next && open()}>
      <PopoverTrigger asChild>
        <Button variant={required ? "claude" : "outline"} size="sm" {...props}>
          <span className="max-w-40 truncate">{label}</span>
          <ChevronDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        {offer === null && busy && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Asking {agent.name} what it offers...
          </p>
        )}
        {offer !== null &&
          (offer.settings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {agent.name} has nothing to pick: it runs on its own setup.
            </p>
          ) : (
            <FieldGroup className="gap-4">
              {offer.settings.map((setting, index) => (
                <SettingField
                  key={setting.id}
                  setting={setting}
                  disabled={busy}
                  onChange={(value) => pick(index, value)}
                />
              ))}
            </FieldGroup>
          ))}
        {offer !== null && busy && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" />
            Checking with {agent.name}...
          </p>
        )}
        {error && <FieldError>{error}</FieldError>}
      </PopoverContent>
    </Popover>
  )
}
