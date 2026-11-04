import { readText } from "@tauri-apps/plugin-clipboard-manager"
import { ClipboardPaste } from "lucide-react"
import {
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  useEffect,
  useState,
} from "react"

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
import { type LiveKitEnv, parseLiveKitEnv } from "./livekit-env"

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
  | { kind: "pasted" }
  | { kind: "error"; message: string }

/** The form starts from what is saved; the secret field always starts empty. */
function fieldsFrom(info: CredentialsInfo | null): Fields {
  return { url: info?.url ?? "", apiKey: info?.apiKey ?? "", apiSecret: "" }
}

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
  const [saved, setSaved] = useState<CredentialsInfo | null>(null)
  const [fields, setFields] = useState<Fields>(fieldsFrom(null))
  const [status, setStatus] = useState<Status>({ kind: "idle" })

  function show(info: CredentialsInfo | null) {
    setSaved(info)
    setFields(fieldsFrom(info))
  }

  // Load once when the section opens (it remounts to focus again). Setters are stable.
  useEffect(() => {
    credentialsInfo().then(
      (info) => {
        setSaved(info)
        setFields(fieldsFrom(info))
        if (focus) document.getElementById(firstEmpty(info))?.focus()
      },
      (error: unknown) => setStatus({ kind: "error", message: String(error) })
    )
  }, [focus])

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

  function fill(env: LiveKitEnv) {
    setFields(env)
    setStatus({ kind: "pasted" })
  }

  /** Fills all three from LiveKit's "Environment variables" box on the clipboard. */
  async function pasteAll() {
    const env = parseLiveKitEnv((await readText().catch(() => "")) ?? "")
    if (env) fill(env)
    else
      setStatus({
        kind: "error",
        message:
          "Copy the Environment variables box from LiveKit, then paste again.",
      })
  }

  /** Pasting that same block into any one field fills all three. */
  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const env = parseLiveKitEnv(event.clipboardData.getData("text"))
    if (!env) return
    event.preventDefault()
    fill(env)
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
        <div className="flex items-start justify-between gap-4">
          <FieldDescription>
            From your LiveKit Cloud project, under Settings, API keys. Copy the
            Environment variables box and paste it here. The free plan is
            enough.
          </FieldDescription>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void pasteAll()}
          >
            <ClipboardPaste />
            Paste all
          </Button>
        </div>

        <Field>
          <FieldLabel htmlFor="livekit-url">Server URL</FieldLabel>
          <Input
            id="livekit-url"
            placeholder="wss://your-project.livekit.cloud"
            value={fields.url}
            onChange={edit("url")}
            onPaste={onPaste}
            {...KEY_INPUT}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="livekit-api-key">API key</FieldLabel>
          <Input
            id="livekit-api-key"
            value={fields.apiKey}
            onChange={edit("apiKey")}
            onPaste={onPaste}
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
            onPaste={onPaste}
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
