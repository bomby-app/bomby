import { readText } from "@tauri-apps/plugin-clipboard-manager"
import { Info } from "lucide-react"
import { type ClipboardEvent, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { LiveKitLogo } from "@/features/setup/provider-logos"

import { type CredentialsInfo, credentialsInfo } from "./api"
import { type LiveKitEnv, parseLiveKitEnv } from "./livekit-env"

type LiveKitFieldValues = LiveKitEnv

// Typed keys, not prose: no spell check, autocorrect or autofill.
const KEY_INPUT = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
} as const

const IDS: Record<keyof LiveKitEnv, string> = {
  url: "url",
  apiKey: "api-key",
  apiSecret: "api-secret",
}

const NO_PASTE =
  "Copy the Environment variables box from LiveKit, then paste again."

/** The secret field always starts empty. */
function fieldsFrom(info: CredentialsInfo | null): LiveKitFieldValues {
  return { url: info?.url ?? "", apiKey: info?.apiKey ?? "", apiSecret: "" }
}

/** The saved LiveKit keys, loaded once into editable fields. */
export function useLiveKitFields() {
  const [saved, setSaved] = useState<CredentialsInfo | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [fields, setFields] = useState(fieldsFrom(null))
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    credentialsInfo().then(
      (info) => {
        setSaved(info)
        setFields(fieldsFrom(info))
        setLoaded(true)
      },
      (error: unknown) => setLoadError(String(error))
    )
  }, [])

  /** Shows what's saved now, after a save or a removal. */
  function show(info: CredentialsInfo | null) {
    setSaved(info)
    setFields(fieldsFrom(info))
  }

  return { saved, loaded, fields, setFields, show, loadError }
}

/** Whether `fields` hold anything not already saved. */
export function changed(
  fields: LiveKitFieldValues,
  saved: CredentialsInfo | null
): boolean {
  return (
    fields.url.trim() !== (saved?.url ?? "") ||
    fields.apiKey.trim() !== (saved?.apiKey ?? "") ||
    fields.apiSecret.trim() !== ""
  )
}

/**
 * The LiveKit server URL, API key and secret, with Paste all and where to find them.
 * Pasting LiveKit's Environment variables box into any field fills all three.
 */
export function LiveKitFields({
  idPrefix,
  fields,
  saved,
  onEdit,
  onPasted,
  onPasteFailed,
}: {
  idPrefix: string
  fields: LiveKitFieldValues
  saved: CredentialsInfo | null
  onEdit: (fields: LiveKitFieldValues) => void
  onPasted: (fields: LiveKitFieldValues) => void
  onPasteFailed: (message: string) => void
}) {
  async function pasteAll() {
    const env = parseLiveKitEnv((await readText().catch(() => "")) ?? "")
    if (env) onPasted(env)
    else onPasteFailed(NO_PASTE)
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const env = parseLiveKitEnv(event.clipboardData.getData("text"))
    if (!env) return
    event.preventDefault()
    onPasted(env)
  }

  function input(name: keyof LiveKitFieldValues) {
    return {
      id: `${idPrefix}-${IDS[name]}`,
      value: fields[name],
      onChange: (event: { target: { value: string } }) =>
        onEdit({ ...fields, [name]: event.target.value }),
      onPaste,
      ...KEY_INPUT,
    }
  }

  return (
    <>
      <Field>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor={`${idPrefix}-${IDS.url}`}>Server URL</FieldLabel>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Where to find these"
                >
                  <Info />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                From your LiveKit Cloud project, under Settings, API keys. Copy
                the Environment variables box and paste it here. The free plan
                is enough.
              </TooltipContent>
            </Tooltip>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void pasteAll()}
            >
              <LiveKitLogo />
              Paste all
            </Button>
          </div>
        </div>
        <Input
          placeholder="wss://your-project.livekit.cloud"
          {...input("url")}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-${IDS.apiKey}`}>API key</FieldLabel>
        <Input {...input("apiKey")} />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-${IDS.apiSecret}`}>
          API secret
        </FieldLabel>
        <Input
          type="password"
          placeholder={
            saved?.hasSecret ? "Saved. Type a new one to replace it." : ""
          }
          {...input("apiSecret")}
        />
      </Field>
    </>
  )
}
