import { useSessionContext, useTrackToggle } from "@livekit/components-react"
import { Track } from "livekit-client"
import { useEffect, useEffectEvent } from "react"

import { commandShortcut } from "@/lib/shortcuts"

/** Mutes or unmutes the mic on a call. Cmd-M is macOS's Minimize, so Shift too. */
export const MUTE_SHORTCUT = commandShortcut("m", { shift: true })

/**
 * The call's mic, through LiveKit's own toggle, the one the control bar's mic button uses:
 * whether there's a connected call to mute, whether the mic is on, and the toggle.
 */
export function useMic(): {
  available: boolean
  enabled: boolean
  toggle: () => void
} {
  const { isConnected } = useSessionContext()
  const mic = useTrackToggle({ source: Track.Source.Microphone })
  return {
    available: isConnected,
    enabled: mic.enabled,
    toggle: () => {
      if (isConnected && !mic.pending) void mic.toggle()
    },
  }
}

/** Cmd-Shift-M mutes or unmutes the mic while a call is connected and the window has focus. */
export function MuteShortcut() {
  const mic = useMic()
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!MUTE_SHORTCUT.matches(event) || !mic.available) return
    event.preventDefault()
    mic.toggle()
  })
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
  return null
}
