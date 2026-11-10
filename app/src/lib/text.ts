// Text for display, shared by the features.

/**
 * The last part of a path: "/Users/me/Dev/samba" -> "samba". Only "/" separates: on macOS
 * a backslash is an ordinary character in a name.
 */
export function folderName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path
}

/** "a", "a and b", "a, b and c". */
export function andList(names: string[]): string {
  if (names.length <= 1) return names.join("")
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
}
