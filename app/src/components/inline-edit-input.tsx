import { type ComponentProps, type KeyboardEvent, useState } from "react"

import { Input } from "@/components/ui/input"

/**
 * An input for a value that's saved as it's edited: Enter or leaving the field saves it,
 * Esc puts it back. `onSave` gets the typed text and resolves to whether it was saved; a
 * failed save puts the saved value back. Remount it (a `key`) when the saved value changes
 * from outside.
 */
export function InlineEditInput({
  value,
  onSave,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "onBlur"> & {
  value: string
  onSave: (value: string) => Promise<boolean>
}) {
  const [draft, setDraft] = useState(value)

  async function commit() {
    if (draft.trim() === value) return setDraft(value)
    if (!(await onSave(draft))) setDraft(value)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") event.currentTarget.blur()
    if (event.key === "Escape") {
      // Keep Esc from reaching anything else while editing.
      event.preventDefault()
      setDraft(value)
      event.currentTarget.blur()
    }
  }

  return (
    <Input
      {...props}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={onKeyDown}
    />
  )
}
