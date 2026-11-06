import { ApiKeyForm } from "@/components/api-key-form"
import { ChoiceList, ChoiceRow } from "@/components/choice-list"
import { InfoTip } from "@/components/info-tip"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { useSettingsNavigation } from "@/lib/settings-navigation"

import {
  clearVoiceKey,
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
      {provider.options.map((option) => (
        <OptionRow
          key={option.id}
          provider={id}
          option={option}
          onChange={(on) =>
            void change(() => setVoiceOption(id, option.id, on))
          }
        />
      ))}
    </ChoiceRow>
  )
}

/** One of the provider's switches, under its key. */
function OptionRow({
  provider,
  option,
  onChange,
}: {
  provider: VoiceProvider
  option: ProviderOption
  onChange: (on: boolean) => void
}) {
  const copy = PROVIDERS[provider].options[option.id]
  if (!copy) return null
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
