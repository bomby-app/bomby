import { type FormEvent, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { FieldError, FieldGroup } from "@/components/ui/field"

import {
  type CredentialsInfo,
  clearCredentials,
  credentialsInfo,
  saveCredentials,
} from "./api"
import { LiveKitFields, useLiveKitFields } from "./livekit-fields"

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "pasted" }
  | { kind: "error"; message: string }

/** The first field still to fill in, for `focus`. */
function firstEmpty(info: CredentialsInfo | null): string {
  if (!info?.url) return "livekit-url"
  if (!info.apiKey) return "livekit-api-key"
  return "livekit-api-secret"
}

/**
 * The LiveKit server and its API key and secret. With `focus`, the first field still to
 * fill in takes focus once the saved values load.
 */
export function LiveKitForm({ focus = false }: { focus?: boolean }) {
  const { saved, loaded, fields, setFields, show, loadError } =
    useLiveKitFields()
  const [status, setStatus] = useState<Status>({ kind: "idle" })

  const focused = useRef(false)
  useEffect(() => {
    if (!focus || !loaded || focused.current) return
    focused.current = true
    document.getElementById(firstEmpty(saved))?.focus()
  }, [focus, loaded, saved])

  async function save(event: FormEvent) {
    event.preventDefault()
    setStatus({ kind: "saving" })
    try {
      await saveCredentials({
        url: fields.url,
        apiKey: fields.apiKey,
        apiSecret: fields.apiSecret || undefined,
      })
      show(await credentialsInfo())
      setStatus({ kind: "saved" })
    } catch (error) {
      setStatus({ kind: "error", message: String(error) })
    }
  }

  async function remove() {
    try {
      await clearCredentials()
      show(null)
      setStatus({ kind: "idle" })
    } catch (error) {
      setStatus({ kind: "error", message: String(error) })
    }
  }

  return (
    <form onSubmit={save}>
      <FieldGroup>
        <LiveKitFields
          idPrefix="livekit"
          fields={fields}
          saved={saved}
          onEdit={(next) => {
            setFields(next)
            if (status.kind !== "saving") setStatus({ kind: "idle" })
          }}
          onPasted={(next) => {
            setFields(next)
            setStatus({ kind: "pasted" })
          }}
          onPasteFailed={(message) => setStatus({ kind: "error", message })}
        />

        {loadError && <FieldError>{loadError}</FieldError>}
        {status.kind === "error" && <FieldError>{status.message}</FieldError>}

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={status.kind === "saving"}>
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
          {status.kind === "pasted" && (
            <span className="text-sm text-muted-foreground">
              Pasted all three. Save to keep them.
            </span>
          )}
        </div>
      </FieldGroup>
    </form>
  )
}
