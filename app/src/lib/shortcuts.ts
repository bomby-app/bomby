const IS_MAC = document.documentElement.dataset.platform === "macos"

export type Shortcut = {
  /** For display in a Kbd group: ["⌘", "N"] on macOS, ["Ctrl", "N"] elsewhere. */
  keys: string[]
  matches: (event: KeyboardEvent) => boolean
}

/** How a key that isn't a character shows in a Kbd. */
const KEY_LABEL: Record<string, string> = { enter: "↩" }

/**
 * Cmd+key on macOS, Ctrl+key elsewhere, with Shift too when `shift`. `key` is the
 * character, or a key's name such as "Enter", case-insensitive.
 */
export function commandShortcut(
  key: string,
  { shift = false }: { shift?: boolean } = {}
): Shortcut {
  const name = key.toLowerCase()
  return {
    keys: [
      IS_MAC ? "⌘" : "Ctrl",
      ...(shift ? [IS_MAC ? "⇧" : "Shift"] : []),
      KEY_LABEL[name] ?? key.toUpperCase(),
    ],
    matches: (event) =>
      event.key.toLowerCase() === name &&
      (IS_MAC ? event.metaKey : event.ctrlKey) &&
      event.shiftKey === shift &&
      !event.altKey,
  }
}
