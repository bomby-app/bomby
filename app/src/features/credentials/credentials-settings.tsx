import { useEffect, useRef } from "react"

import { FieldLegend, FieldSet } from "@/components/ui/field"
import { useSettingsNavigation } from "@/lib/settings-navigation"

import { GeminiForm } from "./gemini-form"
import { LiveKitForm } from "./livekit-form"
import { LiveKitServerChoice } from "./livekit-server-choice"
import { useSavedKeys } from "./use-saved-keys"

/**
 * The Credentials section of the settings window: where calls' LiveKit runs, and the keys
 * the user brings, which live in the system keychain, held by the core. Their LiveKit keys
 * show only when calls use their own server. Sent here for one ("livekit" or "gemini", from
 * Setup), it brings that one into view and focuses its first empty field.
 */
export function CredentialsSettings() {
  const { place } = useSettingsNavigation()
  const { keys } = useSavedKeys()
  const field = place?.section === "credentials" ? place.field : undefined
  const gemini = useRef<HTMLFieldSetElement>(null)

  // LiveKit is at the top already; Gemini may be below the fold.
  useEffect(() => {
    if (field === "gemini") gemini.current?.scrollIntoView({ block: "nearest" })
  }, [field])

  return (
    <div className="flex flex-col gap-10">
      <FieldSet>
        <FieldLegend>LiveKit</FieldLegend>
        <LiveKitServerChoice />
        {keys?.server === "theirs" && (
          <LiveKitForm focus={field === "livekit"} />
        )}
      </FieldSet>
      <FieldSet ref={gemini}>
        <FieldLegend>Gemini</FieldLegend>
        <GeminiForm focus={field === "gemini"} />
      </FieldSet>
    </div>
  )
}
