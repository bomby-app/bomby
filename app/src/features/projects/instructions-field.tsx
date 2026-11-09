import { useState } from "react"

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { charCount, holdToChars } from "@/lib/chars"

import { MAX_INSTRUCTIONS_LENGTH } from "./api"

const count = new Intl.NumberFormat()

/**
 * What the user writes about a project. Bomby and every coding agent are told it once, when
 * a call starts. The new project and project settings dialogs share it.
 *
 * The field is uncontrolled, named `instructions`, so its form's action reads it from
 * `FormData` and React resets it after a successful save. Only its length is kept in state,
 * for the count. `onInput` tells the form the text changed.
 */
export function InstructionsField({
  id,
  defaultValue = "",
  disabled,
  onInput,
}: {
  id: string
  defaultValue?: string
  disabled?: boolean
  onInput?: () => void
}) {
  const [length, setLength] = useState(() => charCount(defaultValue))

  return (
    <Field>
      <div className="flex items-baseline justify-between gap-2">
        <FieldLabel htmlFor={id}>Instructions</FieldLabel>
        <span
          className="text-xs text-muted-foreground tabular-nums"
          aria-hidden
        >
          {count.format(length)} / {count.format(MAX_INSTRUCTIONS_LENGTH)}
        </span>
      </div>
      <Textarea
        id={id}
        name="instructions"
        defaultValue={defaultValue}
        disabled={disabled}
        rows={4}
        placeholder="What the project is, and anything your agents should know about it."
        className="max-h-64 resize-none"
        // Held to the limit as the core counts characters: `maxLength` counts an emoji as two.
        onInput={(e) => {
          holdToChars(
            e.currentTarget,
            MAX_INSTRUCTIONS_LENGTH,
            (e.nativeEvent as InputEvent).isComposing
          )
          setLength(charCount(e.currentTarget.value))
          onInput?.()
        }}
        onCompositionEnd={(e) => {
          holdToChars(e.currentTarget, MAX_INSTRUCTIONS_LENGTH, false)
          setLength(charCount(e.currentTarget.value))
        }}
      />
      <FieldDescription>
        Optional. Bomby and your agents read it when a call starts.
      </FieldDescription>
    </Field>
  )
}

/** The instructions a form submitted, as the core takes them. */
export function submittedInstructions(formData: FormData): string {
  const value = formData.get("instructions")
  return typeof value === "string" ? value : ""
}
