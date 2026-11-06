import { ChoiceList, ChoiceRow } from "@/components/choice-list"
import { FieldError } from "@/components/ui/field"
import { LiveKitLogo } from "@/features/setup/provider-logos"
import { useSettingsNavigation } from "@/lib/settings-navigation"

import type { LiveKitServer } from "./api"
import { LiveKitForm } from "./livekit-form"
import { chooseLiveKitServer, useSavedKeys } from "./use-saved-keys"

/**
 * The Call server section of the settings window: where calls run, LiveKit on this Mac or
 * the user's own LiveKit Cloud with its keys in the keychain
 * (docs/decisions/livekit-on-this-mac-or-cloud.md). Sent here for the keys (field
 * "livekit", from Setup), it focuses the first one still empty. A change applies from the
 * next call; one under way keeps its server.
 */
export function CallServerSettings() {
  const { place } = useSettingsNavigation()
  const { keys, error } = useSavedKeys()
  if (!keys) return error ? <FieldError>{error}</FieldError> : null

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Where your calls run. A change applies from your next call.
      </p>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">LiveKit</h2>
        <ChoiceList<LiveKitServer>
          label="LiveKit"
          value={keys.server}
          onValueChange={(server) => void chooseLiveKitServer(server)}
        >
          <ChoiceRow
            id="livekit-thisMac"
            value="thisMac"
            chosen={keys.server === "thisMac"}
            logo={<LiveKitLogo />}
            title="Local"
            description="Runs on this Mac. Nothing to set up."
          />
          <ChoiceRow
            id="livekit-theirs"
            value="theirs"
            chosen={keys.server === "theirs"}
            logo={<LiveKitLogo className="text-livekit-cloud" />}
            title="Cloud"
            description="Your own LiveKit Cloud project and its keys."
          >
            <LiveKitForm
              focus={
                place?.section === "call-server" && place.field === "livekit"
              }
            />
          </ChoiceRow>
        </ChoiceList>
      </div>
      {error && <FieldError>{error}</FieldError>}
    </div>
  )
}
