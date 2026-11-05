import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"

import { MAX_INSTRUCTIONS_LENGTH } from "./api"

const count = new Intl.NumberFormat()

/**
 * What the user writes about a project. Bomby and every coding agent are told it once, when
 * a call starts. The new project and project settings dialogs share it; each decides when
 * to save.
 */
export function InstructionsField({
  id,
  value,
  onChange,
  onBlur,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
}) {
  return (
    <Field>
      <div className="flex items-baseline justify-between gap-2">
        <FieldLabel htmlFor={id}>Instructions</FieldLabel>
        <span
          className="text-xs text-muted-foreground tabular-nums"
          aria-hidden
        >
          {count.format(value.length)} / {count.format(MAX_INSTRUCTIONS_LENGTH)}
        </span>
      </div>
      <Textarea
        id={id}
        value={value}
        rows={4}
        maxLength={MAX_INSTRUCTIONS_LENGTH}
        placeholder="What the project is, and anything your agents should know about it."
        className="max-h-64 resize-none"
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      <FieldDescription>
        Optional. Bomby and your agents read it when a call starts.
      </FieldDescription>
    </Field>
  )
}
