import { LoaderCircle } from "lucide-react"

import { FieldError, FieldGroup } from "@/components/ui/field"

import { sentence, type Skipped } from "./api"
import { SettingField } from "./setting-field"
import type { AgentSettings } from "./use-agent-settings"

/**
 * What the user can pick for an agent (its model, how hard it thinks, goose's provider), as
 * the agent lists them, with what it's waiting on and anything that went wrong: the inside
 * of the Agents row and of the splash's model picker.
 */
export function ModelSettings({
  name,
  settings: { listed, busy, error, pick },
}: {
  /** The agent's name, for what it says. */
  name: string
  settings: AgentSettings
}) {
  return (
    <div className="flex flex-col gap-3">
      {listed !== null && (
        <Fields
          name={name}
          listed={listed}
          busy={busy !== null}
          onPick={pick}
        />
      )}
      {busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          {busy === "saving" ? "Saving..." : "Getting models..."}
        </p>
      )}
      {error && <FieldError>{error}</FieldError>}
    </div>
  )
}

function Fields({
  name,
  listed,
  busy,
  onPick,
}: {
  name: string
  listed: NonNullable<AgentSettings["listed"]>
  busy: boolean
  onPick: (setting: string, value: string) => void
}) {
  if (listed.settings.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {/* Nothing listed because something's wrong: say what, not "nothing to pick". */}
        {listed.step !== "ready" && listed.problem
          ? sentence(listed.problem)
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
      {listed.settings.map((setting) => {
        // A model it must have picked shows none chosen yet, so picking the one it runs
        // on now saves it like any other (OpenCode).
        const unpicked = listed.step === "pick" && setting.category === "model"
        return (
          <SettingField
            key={setting.id}
            setting={unpicked ? { ...setting, current: "" } : setting}
            placeholder={unpicked ? "Pick a model" : undefined}
            disabled={busy}
            onChange={(value) => onPick(setting.id, value)}
          />
        )
      })}
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
