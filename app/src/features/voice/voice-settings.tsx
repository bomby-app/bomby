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

import { setVoice, type VoiceOptions, voiceOptions } from "./api"

/** The Voice section of the settings window: which Gemini voice Bomby speaks in. */
export function VoiceSettings() {
  const [settings, setSettings] = useState<VoiceOptions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    voiceOptions().then(setSettings, (e: unknown) => setError(String(e)))
  }, [])

  async function choose(name: string | null) {
    if (!settings || !name || name === settings.voice) return
    setError(null)
    setSaved(false)
    try {
      await setVoice(name)
      setSettings({ ...settings, voice: name })
      setSaved(true)
    } catch (e) {
      setError(String(e))
    }
  }

  const current = settings?.voices.find((v) => v.name === settings.voice)

  return (
    <Field>
      <FieldLabel htmlFor="voice">Voice</FieldLabel>
      <Select
        value={settings?.voice}
        onValueChange={(name) => void choose(name)}
        disabled={!settings}
      >
        <SelectTrigger id="voice" className="w-64">
          <SelectValue placeholder="Loading voices..." />
        </SelectTrigger>
        <SelectContent position="popper" className="max-h-80">
          {settings?.voices.map((voice) => (
            <SelectItem key={voice.name} value={voice.name}>
              <span className="font-medium">{voice.name}</span>
              <span className="text-muted-foreground">
                {voice.style}, {voice.pitch.toLowerCase()} pitch
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>
        {current
          ? `${current.style}, ${current.pitch.toLowerCase()} pitch. Your next call uses it.`
          : "Gemini's voices. Your next call uses the one you pick."}
      </FieldDescription>
      {saved && (
        <p className="text-sm text-muted-foreground">
          Saved. Your next call speaks as {settings?.voice}.
        </p>
      )}
      {error && <FieldError>{error}</FieldError>}
    </Field>
  )
}
