import { useEffect, useState } from "react"

import { InlineEditInput } from "@/components/inline-edit-input"
import { MascotCard } from "@/components/mascot-card"
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

import {
  MAX_USER_NAME_LENGTH,
  setTone,
  setUserName,
  type Tone,
  tone as savedTone,
  userName,
} from "./api"

const TONES: { value: Tone; label: string }[] = [
  { value: "sharp", label: "Sharp" },
  { value: "chatty", label: "Chatty" },
  { value: "playful", label: "Playful" },
]

/** The Bomby section of the settings window: what Bomby calls the user, and its tone. */
export function IntroSettings() {
  const [name, setName] = useState<string | null>(null)
  const [tone, setToneState] = useState<Tone | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    userName().then(setName, (e: unknown) => setError(String(e)))
    savedTone().then(setToneState, (e: unknown) => setError(String(e)))
  }, [])

  async function chooseTone(next: Tone) {
    const previous = tone
    setError(null)
    setToneState(next)
    try {
      await setTone(next)
    } catch (e) {
      setToneState(previous)
      setError(String(e))
    }
  }

  async function save(next: string) {
    setError(null)
    try {
      setName(await setUserName(next))
      return true
    } catch (e) {
      setError(String(e))
      return false
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <MascotCard
        state="listening"
        headline="What would you like me to call you?"
        detail="I'll use your name now and then on calls. Leave it empty if you'd rather not say."
      />
      <Field>
        <FieldLabel htmlFor="user-name">Your name</FieldLabel>
        {/* Remounted once the saved name loads, and after each save. */}
        <InlineEditInput
          key={name ?? ""}
          id="user-name"
          value={name ?? ""}
          disabled={name === null}
          maxLength={MAX_USER_NAME_LENGTH}
          placeholder="Optional"
          autoComplete="given-name"
          spellCheck={false}
          className="w-64"
          onSave={save}
        />
        <FieldDescription>Your next call uses it.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="tone">What tone do you prefer?</FieldLabel>
        <Select
          value={tone ?? undefined}
          onValueChange={(value) => void chooseTone(value as Tone)}
          disabled={tone === null}
        >
          <SelectTrigger id="tone" className="w-64">
            <SelectValue placeholder="Loading..." />
          </SelectTrigger>
          <SelectContent position="popper">
            {TONES.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>Your next call uses it.</FieldDescription>
      </Field>
      {error && <FieldError>{error}</FieldError>}
    </div>
  )
}
