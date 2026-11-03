import { FieldLegend, FieldSet } from "@/components/ui/field"
import { GeminiForm } from "./gemini-form"
import { LiveKitForm } from "./livekit-form"

/**
 * The Credentials section of the settings window: the keys the user brings. Both live in
 * the system keychain, held by the core.
 */
export function CredentialsSettings() {
  return (
    <div className="flex flex-col gap-10">
      <FieldSet>
        <FieldLegend>LiveKit</FieldLegend>
        <LiveKitForm />
      </FieldSet>
      <FieldSet>
        <FieldLegend>Gemini</FieldLegend>
        <GeminiForm />
      </FieldSet>
    </div>
  )
}
