import { readText } from "@tauri-apps/plugin-clipboard-manager"
import { Info } from "lucide-react"
import {
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  useState,
  useTransition,
} from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { saveCredentials, saveGeminiKey } from "@/features/credentials/api"
import {
  type LiveKitEnv,
  parseLiveKitEnv,
} from "@/features/credentials/livekit-env"
import {
  checkKeysAgain,
  type Keys,
} from "@/features/credentials/use-saved-keys"
import { LiveKitLogo } from "@/features/setup/provider-logos"

// Typed keys, not prose: no spell check, autocorrect or autofill.
const KEY_INPUT = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
} as const

const SAVED = "Saved. Type a new one to replace it."

/** The splash's "type them in": every key it needs, saved together. */
export function KeysDialog({
  keys,
  open,
  onOpenChange,
}: {
  keys: Keys
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] [scrollbar-width:none] overflow-y-auto sm:max-w-xl [&::-webkit-scrollbar]:hidden">
        <DialogHeader>
          <DialogTitle>Your keys</DialogTitle>
          <DialogDescription>
            Kept in your Mac's keychain, never sent anywhere else.
          </DialogDescription>
        </DialogHeader>
        <KeysForm keys={keys} onSaved={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function KeysForm({ keys, onSaved }: { keys: Keys; onSaved: () => void }) {
  const cloud = keys.server === "theirs"
  const [livekit, setLiveKit] = useState<LiveKitEnv>({
    url: "",
    apiKey: "",
    apiSecret: "",
  })
  const [gemini, setGemini] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()
  const typedLiveKit =
    cloud && Object.values(livekit).some((value) => value.trim() !== "")
  const typedGemini = gemini.trim() !== ""

  function save(event: FormEvent) {
    event.preventDefault()
    startSaving(async () => {
      try {
        if (typedLiveKit)
          await saveCredentials({
            url: livekit.url,
            apiKey: livekit.apiKey,
            apiSecret: livekit.apiSecret || undefined,
          })
        if (typedGemini) await saveGeminiKey(gemini)
      } catch (e) {
        setError(String(e))
        return
      }
      await checkKeysAgain()
      onSaved()
    })
  }

  function edit(name: keyof LiveKitEnv) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setLiveKit((current) => ({ ...current, [name]: event.target.value }))
      setError(null)
    }
  }

  // Pasting LiveKit's Environment variables box into any field fills all three.
  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const env = parseLiveKitEnv(event.clipboardData.getData("text"))
    if (!env) return
    event.preventDefault()
    setLiveKit(env)
  }

  async function pasteAll() {
    const env = parseLiveKitEnv((await readText().catch(() => "")) ?? "")
    if (env) setLiveKit(env)
    else
      setError(
        "Copy the Environment variables box from LiveKit, then paste again."
      )
  }

  return (
    <form onSubmit={save}>
      <FieldGroup>
        {cloud && (
          <>
            <FieldSet>
              <div className="flex items-center justify-between gap-4">
                <FieldLegend>LiveKit</FieldLegend>
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
                      From your LiveKit Cloud project, under Settings, API keys.
                      Copy the Environment variables box and paste it here. The
                      free plan is enough.
                    </TooltipContent>
                  </Tooltip>

                  <Button
                    type="button"
                    variant="claude"
                    size="sm"
                    onClick={() => void pasteAll()}
                  >
                    <LiveKitLogo />
                    Paste all
                  </Button>
                </div>
              </div>
              <Field>
                <FieldLabel htmlFor="keys-livekit-url">Server URL</FieldLabel>
                <Input
                  id="keys-livekit-url"
                  placeholder="wss://your-project.livekit.cloud"
                  value={livekit.url}
                  onChange={edit("url")}
                  onPaste={onPaste}
                  {...KEY_INPUT}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="keys-livekit-api-key">API key</FieldLabel>
                <Input
                  id="keys-livekit-api-key"
                  value={livekit.apiKey}
                  onChange={edit("apiKey")}
                  onPaste={onPaste}
                  {...KEY_INPUT}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="keys-livekit-api-secret">
                  API secret
                </FieldLabel>
                <Input
                  id="keys-livekit-api-secret"
                  type="password"
                  placeholder={keys.theirLiveKit ? SAVED : ""}
                  value={livekit.apiSecret}
                  onChange={edit("apiSecret")}
                  onPaste={onPaste}
                  {...KEY_INPUT}
                />
              </Field>
            </FieldSet>
            <FieldSeparator />
          </>
        )}
        <FieldSet>
          <FieldLegend>Gemini</FieldLegend>
          <FieldDescription>
            From Google AI Studio, under API keys.
          </FieldDescription>
          <Field>
            <FieldLabel htmlFor="keys-gemini-api-key">API key</FieldLabel>
            <Input
              id="keys-gemini-api-key"
              type="password"
              placeholder={keys.gemini ? SAVED : ""}
              value={gemini}
              onChange={(event) => {
                setGemini(event.target.value)
                setError(null)
              }}
              {...KEY_INPUT}
            />
          </Field>
        </FieldSet>
        {error && <FieldError>{error}</FieldError>}
        <div>
          <Button
            type="submit"
            variant="highlighter"
            disabled={saving || !(typedLiveKit || typedGemini)}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
