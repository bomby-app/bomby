import { Track } from "livekit-client"

import { showErrorToast } from "@/components/error-toast"
import { log } from "@/lib/log"

/**
 * The control bar's device errors: the mic failing mid-call, or a mic picked in its menu
 * that won't open. The raw error goes to the log, a toast tells the user. The bar has no
 * camera or screen share, but anything else it reports is logged too.
 */
export function reportDeviceError({
  source,
  error,
}: {
  source: Track.Source
  error: Error
}) {
  log(`${source} device failed: ${String(error)}`)
  if (source === Track.Source.Microphone)
    showErrorToast("Couldn't use the mic. Check it's connected and allowed?")
}
