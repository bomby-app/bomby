import type { ComponentProps, FocusEvent, KeyboardEvent } from "react"

import { Input } from "@/components/ui/input"

/**
 * An input for a value that's saved as it's edited: Enter or leaving the field saves it,
 * Esc puts it back. `onSave` gets the typed text and resolves to whether it was saved; a
 * failed save puts the saved value back.
 *
 * The field is uncontrolled: it starts at `value` and the browser keeps what's typed, so a
 * save always reads what's in the field, never a copy of it in state. Remount it (a `key`)
 * when the saved value changes, so it starts at the new one.
 */
export function InlineEditInput({
  value,
  onSave,
  ...props
}: Omit<
  ComponentProps<typeof Input>,
  "value" | "defaultValue" | "onChange" | "onBlur" | "onKeyDown"
> & {
  value: string
  onSave: (value: string) => Promise<boolean>
}) {
  async function commit(event: FocusEvent<HTMLInputElement>) {
    const field = event.currentTarget
    if (field.value.trim() === value) {
      field.value = value
      return
    }
    if (!(await onSave(field.value))) field.value = value
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") event.currentTarget.blur()
    if (event.key === "Escape") {
      // Keep Esc from reaching anything else while editing. Putting the saved value back
      // first means leaving the field finds nothing to save.
      event.preventDefault()
      event.currentTarget.value = value
      event.currentTarget.blur()
    }
  }

  return (
    <Input
      {...props}
      defaultValue={value}
      onBlur={(event) => void commit(event)}
      onKeyDown={onKeyDown}
    />
  )
}
