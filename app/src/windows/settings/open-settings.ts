import { invoke } from "@tauri-apps/api/core"

const IS_MAC = document.documentElement.dataset.platform === "macos"

/** The standard settings shortcut: Cmd+, on macOS, Ctrl+, elsewhere. */
export const SETTINGS_SHORTCUT = {
  keys: IS_MAC ? ["⌘", ","] : ["Ctrl", ","],
  matches: (event: KeyboardEvent) =>
    event.key === "," && (IS_MAC ? event.metaKey : event.ctrlKey),
}

/** Opens the settings window over the main one, or focuses it (the core's `open_settings`). */
export function openSettings(): Promise<void> {
  return invoke("open_settings")
}
