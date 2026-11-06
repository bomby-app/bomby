import { ApiKeyForm } from "@/components/api-key-form"
import { ChoiceList, ChoiceRow } from "@/components/choice-list"
import { InfoTip } from "@/components/info-tip"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { useSettingsNavigation } from "@/lib/settings-navigation"
import { cn } from "@/lib/utils"

import {
  clearVoiceKey,
  type OptionValue,
  type ProviderOption,
  type ProviderSettings,
  saveVoiceKey,
  setVoice,
  setVoiceOption,
  setVoiceProvider,
  type VoiceProvider,
} from "./api"
import { PROVIDERS } from "./providers"
import { changeVoice as change, useVoiceSettings } from "./use-voice-settings"
import { VoiceSelect } from "./voice-select"

/**
 * The Voice section of the settings window: who Bomby talks through, with that provider's
 * key and switches, then its voice (docs/decisions/voice-providers-like-harnesses.md).
 * Sent here for the key (field "key", from Setup), it focuses the picked provider's.
 */
export function VoiceSettings() {
  const { place } = useSettingsNavigation()
  const { settings: saved, error } = useVoiceSettings()

  if (!saved) return error ? <FieldError>{error}</FieldError> : null
  const picked = saved.providers.find((p) => p.provider === saved.provider)

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Who Bomby talks through, and how it sounds. Your next call uses what you
        pick.
      </p>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Provider</h2>
        <ChoiceList<VoiceProvider>
          label="Provider"
          value={saved.provider}
          onValueChange={(provider) =>
            void change(() => setVoiceProvider(provider))
          }
        >
          {saved.providers.map((provider) => (
            <ProviderRow
              key={provider.provider}
              provider={provider}
              chosen={provider.provider === saved.provider}
              focusKey={place?.section === "voice" && place.field === "key"}
            />
          ))}
        </ChoiceList>
      </div>
      {picked && (
        <Field>
          <FieldLabel htmlFor="voice">Voice</FieldLabel>
          <VoiceSelect
            id="voice"
            provider={picked}
            onChange={(voice) =>
              void change(() => setVoice(picked.provider, voice))
            }
          />
          <p className="text-sm text-muted-foreground">
            {PROVIDERS[picked.provider].name}&apos;s voices. Your next call
            speaks as {picked.voices.find((v) => v.id === picked.voice)?.name}.
          </p>
        </Field>
      )}
      {error && <FieldError>{error}</FieldError>}
    </div>
  )
}

function ProviderRow({
  provider,
  chosen,
  focusKey,
}: {
  provider: ProviderSettings
  chosen: boolean
  focusKey: boolean
}) {
  const copy = PROVIDERS[provider.provider]
  const Logo = copy.logo
  const id = provider.provider

  return (
    <ChoiceRow
      id={`provider-${id}`}
      value={id}
      chosen={chosen}
      logo={<Logo />}
      title={copy.name}
      description={copy.description}
      badge={
        copy.experimental && (
          <span className="rounded-full bg-highlighter px-1.5 py-px text-label font-medium text-highlighter-foreground">
            Experimental
          </span>
        )
      }
    >
      <ApiKeyForm
        id={`${id}-api-key`}
        saved={provider.hasKey}
        keysUrl={copy.keysUrl}
        hint={`Add a key to talk through ${copy.name}.`}
        focus={focusKey}
        save={(key) => saveVoiceKey(id, key)}
        remove={() => clearVoiceKey(id)}
      />
      {groups(provider.options).map((group) =>
        group.kind === "switch" ? (
          <SwitchRow
            key={group.option.id}
            provider={id}
            option={group.option}
            onChange={(value) =>
              void change(() => setVoiceOption(id, group.option.id, value))
            }
          />
        ) : (
          <ChoicesRow
            key={group.options[0]?.id}
            provider={id}
            options={group.options}
            onChange={(option, value) =>
              void change(() => setVoiceOption(id, option, value))
            }
          />
        )
      )}
    </ChoiceRow>
  )
}

type SwitchOption = Extract<ProviderOption, { kind: "switch" }>
type ChoiceOption = Extract<ProviderOption, { kind: "choice" }>

/** Each switch on its own row; choices next to each other share one (Paper: model and effort). */
type Group =
  | { kind: "switch"; option: SwitchOption }
  | { kind: "choices"; options: ChoiceOption[] }

function groups(options: ProviderOption[]): Group[] {
  const grouped: Group[] = []
  for (const option of options) {
    const last = grouped.at(-1)
    if (option.kind === "switch") grouped.push({ kind: "switch", option })
    else if (last?.kind === "choices") last.options.push(option)
    else grouped.push({ kind: "choices", options: [option] })
  }
  return grouped
}

/** Choices on one line under a rule: the first takes the room, the rest 140px each. */
function ChoicesRow({
  provider,
  options,
  onChange,
}: {
  provider: VoiceProvider
  options: ChoiceOption[]
  onChange: (option: string, value: OptionValue) => void
}) {
  return (
    <div className="flex flex-col">
      <Separator />
      <div className="flex gap-3 pt-3.5">
        {options.map((option, index) => {
          const copy = PROVIDERS[provider].options[option.id]
          if (copy?.kind !== "choice") return null
          const id = `${provider}-${option.id}`
          return (
            <div
              key={option.id}
              className={cn(
                "flex min-w-0 flex-col gap-2",
                index === 0 ? "flex-1" : "w-[140px] shrink-0"
              )}
            >
              <div className="flex h-5 items-center gap-1">
                <FieldLabel htmlFor={id}>{copy.title}</FieldLabel>
                {copy.info && <InfoTip>{copy.info}</InfoTip>}
              </div>
              <Select
                value={option.value}
                onValueChange={(value) => onChange(option.id, value)}
              >
                <SelectTrigger id={id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {option.values.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** One of the provider's switches, under its key. */
function SwitchRow({
  provider,
  option,
  onChange,
}: {
  provider: VoiceProvider
  option: SwitchOption
  onChange: (on: boolean) => void
}) {
  const copy = PROVIDERS[provider].options[option.id]
  if (copy?.kind !== "switch") return null
  const Icon = copy.icon
  const id = `${provider}-${option.id}`

  return (
    <div className="flex flex-col">
      <Separator />
      <div className="flex items-center gap-3 pt-3.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
          <Icon className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
          <div className="flex items-center gap-1">
            <FieldLabel htmlFor={id}>{copy.title}</FieldLabel>
            <InfoTip>{copy.info}</InfoTip>
          </div>
          <span className="text-muted-foreground">{copy.line}</span>
        </div>
        <Switch id={id} checked={option.on} onCheckedChange={onChange} />
      </div>
    </div>
  )
}
