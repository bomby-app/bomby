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
  type Listed,
  pickAgentSettings,
  type Skipped,
} from "./api"
import { SettingField } from "./setting-field"
import { setupStep } from "./use-agents"

/** The last answer from each agent, so the picker opens on it while it asks again. */
const lastListed = new Map<string, Listed>()

/**
 * The model an agent runs on in calls, and a way to change it, like Buzz's model picker
 * (docs/decisions/pick-agent-settings-like-buzz-and-zed.md): the button names the model;
 * opening it shows what the agent offered last and asks it again, and each pick is saved
 * once the agent has taken it. Picking is optional, unless the agent's harness requires it
 * (`model_selection_required`); without picks an agent runs on its own defaults.
 */
export function ModelPicker({
  agent,
  ...props
}: { agent: AgentStatus } & Omit<ComponentProps<typeof Button>, "onClick">) {
  const [listed, setListed] = useState<Listed | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function shown(next: Listed) {
    lastListed.set(agent.id, next)
    setListed(next)
    setError(null)
    setBusy(false)
  }

  function failed(e: unknown) {
    setError(String(e))
    setBusy(false)
  }

  function open() {
    // A pick still on its way answers for both.
    if (busy) return
    setListed(lastListed.get(agent.id) ?? null)
    setBusy(true)
    setError(null)
    agentSettings(agent.id).then(shown, failed)
  }

  /** A pick for the setting at `index`; the ones after it go back to what the agent offers. */
  function pick(index: number, value: string) {
    if (!listed) return
    const settings = listed.settings.map((setting, i) =>
      i === index ? { ...setting, current: value } : setting
    )
    // Shown at once; the agent's answer follows, with anything the pick changed.
    setListed({ ...listed, settings })
    setBusy(true)
    // The ones before it are saved too: a later setting can depend on them (goose's models
    // on its provider), so its value only means something with theirs.
    const picks = settings
      .slice(0, index + 1)
      .map((s) => ({ setting: s.id, value: s.current }))
    pickAgentSettings(agent.id, picks).then(shown, failed)
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
        {listed === null && busy && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Asking {agent.name} what it offers...
          </p>
        )}
        {listed !== null && (
          <Settings
            listed={listed}
            name={agent.name}
            busy={busy}
            onPick={pick}
          />
        )}
        {listed !== null && busy && (
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

function Settings({
  listed,
  name,
  busy,
  onPick,
}: {
  listed: Listed
  name: string
  busy: boolean
  onPick: (index: number, value: string) => void
}) {
  if (listed.settings.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {/* Nothing listed because something's wrong: say what, not "nothing to pick". */}
        {!listed.ready && listed.problem
          ? `${listed.problem}.`
          : `${name} has nothing to pick: it runs on its own setup.`}
      </p>
    )
  return (
    <FieldGroup className="gap-4">
      {listed.skipped.map((skipped) => (
        <p key={skipped.setting} className="text-sm text-muted-foreground">
          {skippedNote(skipped, name)}
        </p>
      ))}
      {listed.settings.map((setting, index) => (
        <SettingField
          key={setting.id}
          setting={setting}
          disabled={busy}
          onChange={(value) => onPick(index, value)}
        />
      ))}
    </FieldGroup>
  )
}

/** Why a pick didn't apply, by the setting's own name: "The model you picked...". */
export function skippedNote({ name, why }: Skipped, agent: string): string {
  const setting = name.toLowerCase()
  return why === "refused"
    ? `${agent} wouldn't take the ${setting} you picked, so it runs on its default. Pick another.`
    : `The ${setting} you picked isn't offered any more, so it runs on its default. Pick another.`
}
