import { type FormEvent, useState, useTransition } from "react"

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
import { saveCredentials } from "@/features/call-server/api"
import {
  changed,
  LiveKitFields,
  useLiveKitFields,
} from "@/features/call-server/livekit-fields"
import {
  checkKeysAgain,
  type Keys,
} from "@/features/call-server/use-saved-keys"
import { saveVoiceKey } from "@/features/voice/api"
import { PROVIDERS } from "@/features/voice/providers"

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
  const livekit = useLiveKitFields()
  const [voiceKey, setVoiceKey] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()
  const typedLiveKit = cloud && changed(livekit.fields, livekit.saved)
  // Only the picked provider's: the splash picks one before offering to type its key.
  const voice = keys.voice
  const typedVoice = voice !== null && voiceKey.trim() !== ""

  function save(event: FormEvent) {
    event.preventDefault()
    startSaving(async () => {
      try {
        if (typedLiveKit)
          await saveCredentials({
            url: livekit.fields.url,
            apiKey: livekit.fields.apiKey,
            apiSecret: livekit.fields.apiSecret || undefined,
          })
        if (typedVoice) await saveVoiceKey(voice, voiceKey)
      } catch (e) {
        setError(String(e))
        return
      }
      await checkKeysAgain()
      onSaved()
    })
  }

  function edit(fields: typeof livekit.fields) {
    livekit.setFields(fields)
    setError(null)
  }

  const shownError = error ?? livekit.loadError

  return (
    <form onSubmit={save}>
      <FieldGroup>
        {cloud && (
          <>
            <FieldSet>
              <FieldLegend>LiveKit</FieldLegend>
              <LiveKitFields
                idPrefix="keys-livekit"
                fields={livekit.fields}
                saved={livekit.saved}
                onEdit={edit}
                onPasted={edit}
                onPasteFailed={setError}
              />
            </FieldSet>
            <FieldSeparator />
          </>
        )}
        {voice && (
          <FieldSet>
            <FieldLegend>{PROVIDERS[voice].name}</FieldLegend>
            <FieldDescription>{PROVIDERS[voice].keysHow}</FieldDescription>
            <Field>
              <FieldLabel htmlFor="keys-voice-api-key">API key</FieldLabel>
              <Input
                id="keys-voice-api-key"
                type="password"
                placeholder={
                  keys.voiceKeys[voice]
                    ? "Saved. Type a new one to replace it."
                    : ""
                }
                value={voiceKey}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setVoiceKey(event.target.value)
                  setError(null)
                }}
              />
            </Field>
          </FieldSet>
        )}
        {shownError && <FieldError>{shownError}</FieldError>}
        <div>
          <Button
            type="submit"
            variant="highlighter"
            disabled={saving || !(typedLiveKit || typedVoice)}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
