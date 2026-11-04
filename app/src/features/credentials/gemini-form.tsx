import { type FormEvent, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { clearGeminiKey, hasGeminiKey, saveGeminiKey } from "./api"

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string }

/**
 * The Gemini API key the voice runs on. Write-only: the page never sees it again. With
 * `focus`, the key field takes focus when the form opens.
 */
export function GeminiForm({ focus = false }: { focus?: boolean }) {
  const [saved, setSaved] = useState(false)
  const [key, setKey] = useState("")
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focus) input.current?.focus()
  }, [focus])

  useEffect(() => {
    hasGeminiKey().then(setSaved, (error: unknown) =>
      setStatus({ kind: "error", message: String(error) })
    )
  }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    setStatus({ kind: "saving" })
    try {
      await saveGeminiKey(key)
      setSaved(true)
      setKey("")
      setStatus({ kind: "saved" })
    } catch (error) {
      setStatus({ kind: "error", message: String(error) })
    }
  }

  async function remove() {
    try {
      await clearGeminiKey()
      setSaved(false)
      setStatus({ kind: "idle" })
    } catch (error) {
      setStatus({ kind: "error", message: String(error) })
    }
  }

  return (
    <form onSubmit={save}>
      <FieldGroup>
        <FieldDescription>
          From Google AI Studio, under API keys.
        </FieldDescription>
        <Field>
          <FieldLabel htmlFor="gemini-api-key">API key</FieldLabel>
          <Input
            ref={input}
            id="gemini-api-key"
            type="password"
            placeholder={saved ? "Saved. Type a new one to replace it." : ""}
            value={key}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setKey(e.target.value)
              if (status.kind !== "saving") setStatus({ kind: "idle" })
            }}
          />
        </Field>
        {status.kind === "error" && <FieldError>{status.message}</FieldError>}
        <div className="flex items-center gap-2">
          <Button
            type="submit"
            disabled={status.kind === "saving" || !key.trim()}
          >
            {status.kind === "saving" ? "Saving..." : "Save"}
          </Button>
          {saved && (
            <Button type="button" variant="ghost" onClick={remove}>
              Remove
            </Button>
          )}
          {status.kind === "saved" && (
            <span className="text-sm text-muted-foreground">Saved</span>
          )}
        </div>
      </FieldGroup>
    </form>
  )
}
