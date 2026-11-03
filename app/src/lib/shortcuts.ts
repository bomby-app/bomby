const IS_MAC = document.documentElement.dataset.platform === "macos"

export type Shortcut = {
  /** For display in a Kbd group: ["⌘", "N"] on macOS, ["Ctrl", "N"] elsewhere. */
  keys: string[]
  matches: (event: KeyboardEvent) => boolean
}

/** Cmd+key on macOS, Ctrl+key elsewhere. `key` is the character, case-insensitive. */
export function commandShortcut(key: string): Shortcut {
  return {
    keys: [IS_MAC ? "⌘" : "Ctrl", key.toUpperCase()],
    matches: (event) =>
      event.key.toLowerCase() === key.toLowerCase() &&
      (IS_MAC ? event.metaKey : event.ctrlKey) &&
      !event.shiftKey &&
      !event.altKey,
  }
}
