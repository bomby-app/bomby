import { useEffect, useState } from "react"

import { InlineEditInput } from "@/components/inline-edit-input"
import { MascotCard } from "@/components/mascot-card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"

import { MAX_USER_NAME_LENGTH, setUserName, userName } from "./api"

/** The Intro section of the settings window: what Bomby calls the user, if anything. */
export function IntroSettings() {
  const [name, setName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    userName().then(setName, (e: unknown) => setError(String(e)))
  }, [])

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
        {error && <FieldError>{error}</FieldError>}
      </Field>
    </div>
  )
}
