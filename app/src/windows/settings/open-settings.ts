import { call } from "@/lib/core"
import { commandShortcut } from "@/lib/shortcuts"

/** The standard settings shortcut: Cmd+, on macOS, Ctrl+, elsewhere. */
export const SETTINGS_SHORTCUT = commandShortcut(",")

/** Opens the settings window over the main one, or focuses it (the core's `open_settings`). */
export function openSettings(): Promise<void> {
  return call("open_settings")
}
