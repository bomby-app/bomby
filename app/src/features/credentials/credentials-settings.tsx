import { type ChangeEvent, type FormEvent, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  type CredentialsInfo,
  clearCredentials,
  credentialsInfo,
  saveCredentials,
} from "./api"

// Typed keys, not prose: no spell check, autocorrect or autofill.
const KEY_INPUT = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
} as const

type Fields = { url: string; apiKey: string; apiSecret: string }

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string }

/** The form starts from what is saved; the secret field always starts empty. */
function fieldsFrom(info: CredentialsInfo | null): Fields {
  return { url: info?.url ?? "", apiKey: info?.apiKey ?? "", apiSecret: "" }
}

/** The Credentials section of the settings window: the LiveKit server and its API key. */
export function CredentialsSettings() {
  const [saved, setSaved] = useState<CredentialsInfo | null>(null)
  const [fields, setFields] = useState<Fields>(fieldsFrom(null))
  const [status, setStatus] = useState<Status>({ kind: "idle" })

  function show(info: CredentialsInfo | null) {
    setSaved(info)
    setFields(fieldsFrom(info))
  }

  // Load once when the section opens. Setters are stable, so this needs no dependencies.
  useEffect(() => {
    credentialsInfo().then(
      (info) => {
        setSaved(info)
        setFields(fieldsFrom(info))
      },
      (error: unknown) => setStatus({ kind: "error", message: String(error) })
    )
  }, [])

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

  /** Change handler for one field; typing clears the last save or error message. */
  function edit(name: keyof Fields) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setFields((current) => ({ ...current, [name]: event.target.value }))
      if (status.kind !== "saving") setStatus({ kind: "idle" })
    }
  }

  return (
    <form onSubmit={save}>
      <FieldGroup>
        <FieldDescription>
          Your LiveKit project's server and API key, from the LiveKit Cloud
          dashboard under Settings, API keys. Stored in your system keychain.
        </FieldDescription>

        <Field>
          <FieldLabel htmlFor="livekit-url">Server URL</FieldLabel>
          <Input
            id="livekit-url"
            placeholder="wss://your-project.livekit.cloud"
            value={fields.url}
            onChange={edit("url")}
            {...KEY_INPUT}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="livekit-api-key">API key</FieldLabel>
          <Input
            id="livekit-api-key"
            value={fields.apiKey}
            onChange={edit("apiKey")}
            {...KEY_INPUT}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="livekit-api-secret">API secret</FieldLabel>
          <Input
            id="livekit-api-secret"
            type="password"
            placeholder={
              saved?.hasSecret ? "Saved. Type a new one to replace it." : ""
            }
            value={fields.apiSecret}
            onChange={edit("apiSecret")}
            {...KEY_INPUT}
          />
        </Field>

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
        </div>
      </FieldGroup>
    </form>
  )
}
