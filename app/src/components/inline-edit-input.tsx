import {
  type ComponentProps,
  type FocusEvent,
  type KeyboardEvent,
  useRef,
  useState,
} from "react"

import { Input } from "@/components/ui/input"
import { holdToChars } from "@/lib/chars"

/**
 * An input for a value that's saved as it's edited: Enter or leaving the field saves it,
 * Esc puts it back. `onSave` gets the typed text and resolves to whether it was saved; a
 * failed save puts the saved value back. `onDone` follows once the field is left, after
 * any save, also when nothing changed. While a save is on its way the field is read-only,
 * so nothing typed then is lost or saved twice. Enter that ends an input method's
 * composition (Japanese, Chinese) stays the composition's. `maxChars` limits it as the
 * core counts characters, where `maxLength` would count an emoji as two.
 *
 * The field is uncontrolled: it starts at `value` and the browser keeps what's typed, so a
 * save always reads what's in the field, never a copy of it in state. Remount it (a `key`)
 * when the saved value changes, so it starts at the new one.
 */
export function InlineEditInput({
  value,
  onSave,
  onDone,
  maxChars,
  ...props
}: Omit<
  ComponentProps<typeof Input>,
  | "value"
  | "defaultValue"
  | "onChange"
  | "onBlur"
  | "onKeyDown"
  | "maxLength"
  | "onInput"
  | "onCompositionEnd"
> & {
  value: string
  onSave: (value: string) => Promise<boolean>
  onDone?: () => void
  maxChars?: number
}) {
  const [saving, setSaving] = useState(false)
  // Read where the blur happens, before React has re-rendered the field read-only.
  const committing = useRef(false)

  async function commit(event: FocusEvent<HTMLInputElement>) {
    if (committing.current) return
    committing.current = true
    setSaving(true)
    const field = event.currentTarget
    try {
      if (field.value.trim() === value) {
        field.value = value
        return
      }
      if (!(await onSave(field.value))) field.value = value
    } finally {
      committing.current = false
      setSaving(false)
      onDone?.()
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // WebKit reports the key ending a composition as 229 rather than `isComposing`.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
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
      readOnly={saving || props.readOnly}
      aria-busy={saving || undefined}
      defaultValue={value}
      onBlur={(event) => void commit(event)}
      onKeyDown={onKeyDown}
      onInput={(event) => {
        if (maxChars !== undefined)
          holdToChars(
            event.currentTarget,
            maxChars,
            (event.nativeEvent as InputEvent).isComposing
          )
      }}
      onCompositionEnd={(event) => {
        if (maxChars !== undefined)
          holdToChars(event.currentTarget, maxChars, false)
      }}
    />
  )
}
