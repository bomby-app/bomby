import { useEffect, useState } from "react"

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { setVoice, type VoiceSettings as Options, voiceSettings } from "./api"

/** The Voice section of the settings window: which Gemini voice Bomby speaks in. */
export function VoiceSettings() {
  const [settings, setSettings] = useState<Options | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    voiceSettings().then(setSettings, (e: unknown) => setError(String(e)))
  }, [])

  const provider =
    settings?.providers.find((p) => p.provider === settings.provider) ??
    settings?.providers[0]

  async function choose(name: string | null) {
    if (!settings || !provider || !name || name === provider.voice) return
    setError(null)
    setSaved(false)
    try {
      await setVoice(provider.provider, name)
      setSettings({
        ...settings,
        providers: settings.providers.map((p) =>
          p.provider === provider.provider ? { ...p, voice: name } : p
        ),
      })
      setSaved(true)
    } catch (e) {
      setError(String(e))
    }
  }

  const current = provider?.voices.find((v) => v.id === provider.voice)

  return (
    <Field>
      <FieldLabel htmlFor="voice">Voice</FieldLabel>
      <Select
        value={provider?.voice}
        onValueChange={(name) => void choose(name)}
        disabled={!settings}
      >
        <SelectTrigger id="voice" className="w-64">
          <SelectValue placeholder="Loading voices..." />
        </SelectTrigger>
        <SelectContent position="popper" className="max-h-80">
          {provider?.voices.map((voice) => (
            <SelectItem key={voice.id} value={voice.id}>
              <span className="font-medium">{voice.name}</span>
              <span className="text-muted-foreground">{voice.description}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>
        {current
          ? `${current.description}. Your next call uses it.`
          : "Gemini's voices. Your next call uses the one you pick."}
      </FieldDescription>
      {saved && (
        <p className="text-sm text-muted-foreground">
          Saved. Your next call speaks as {current?.name}.
        </p>
      )}
      {error && <FieldError>{error}</FieldError>}
    </Field>
  )
}
