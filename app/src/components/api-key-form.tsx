import { openUrl } from "@tauri-apps/plugin-opener"
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"

import { InfoTip } from "@/components/info-tip"
import { InlineLink } from "@/components/inline-link"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "removing" }
  | { kind: "saved" }
  | { kind: "error"; message: string }

/**
 * One service's API key: a field, Save and Remove, and where to get one. Write-only: the
 * page never sees the key again, only whether one is saved.
 */
export function ApiKeyForm({
  id,
  label = "API key",
  saved,
  keysUrl,
  hint,
  info,
  focus = false,
  save,
  remove,
}: {
  /** The field's id. */
  id: string
  /** What the field is called. */
  label?: string
  saved: boolean
  /** Where the user gets a key, if Bomby knows. */
  keysUrl?: string
  /** Shown under the field while no key is saved. */
  hint?: string
  /** What the (i) beside the label explains, if anything. */
  info?: ReactNode
  /** Takes focus once, while no key is saved. */
  focus?: boolean
  save: (key: string) => Promise<void>
  remove: () => Promise<void>
}) {
  const [key, setKey] = useState("")
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  // Apart from `status`, so a link that can't open never ends a save or removal early.
  const [linkError, setLinkError] = useState<string | null>(null)
  // Save and Remove never overlap.
  const busy = status.kind === "saving" || status.kind === "removing"

  const focused = useRef(false)
  useEffect(() => {
    if (!focus || saved || focused.current) return
    focused.current = true
    document.getElementById(id)?.focus()
  }, [focus, saved, id])

  async function onSave(event: FormEvent) {
    event.preventDefault()
    setStatus({ kind: "saving" })
    try {
      await save(key)
      setKey("")
      setStatus({ kind: "saved" })
    } catch (e) {
      setStatus({ kind: "error", message: String(e) })
    }
  }

  async function onRemove() {
    setStatus({ kind: "removing" })
    try {
      await remove()
      setStatus({ kind: "idle" })
    } catch (e) {
      setStatus({ kind: "error", message: String(e) })
    }
  }

  return (
    <form onSubmit={onSave}>
      <FieldGroup className="gap-3">
        <Field>
          <div className="flex items-center justify-between gap-2">
            <div className="flex h-5 items-center gap-1">
              <FieldLabel htmlFor={id}>{label}</FieldLabel>
              {info && <InfoTip>{info}</InfoTip>}
            </div>
            {keysUrl && (
              <InlineLink
                className="text-sm"
                onClick={() => {
                  setLinkError(null)
                  openUrl(keysUrl).catch(() =>
                    setLinkError(
                      `Couldn't open ${keysUrl}. Open it in your browser.`
                    )
                  )
                }}
              >
                Get an API key
              </InlineLink>
            )}
          </div>
          <Input
            id={id}
            type="password"
            placeholder={saved ? "Saved. Type a new one to replace it." : ""}
            value={key}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setKey(event.target.value)
              if (!busy) setStatus({ kind: "idle" })
            }}
          />
          {!saved && hint && <FieldDescription>{hint}</FieldDescription>}
        </Field>
        {status.kind === "error" && <FieldError>{status.message}</FieldError>}
        {linkError && <FieldError>{linkError}</FieldError>}
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={busy || !key.trim()}>
            {status.kind === "saving" ? "Saving..." : "Save"}
          </Button>
          {saved && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={onRemove}
            >
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
