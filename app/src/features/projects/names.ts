/** The last part of a path: "/Users/me/Dev/samba" -> "samba". */
export function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

/** `wanted`, or `wanted 2`, `wanted 3`... so it doesn't clash (case-insensitive). */
export function uniqueName(wanted: string, taken: readonly string[]): string {
  const used = new Set(taken.map((name) => name.toLowerCase()))
  let name = wanted
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${wanted} ${n}`
  return name
}

/** A call's label in the tree: "Today, 21:40", "Yesterday, 09:05", "3 Nov, 21:40". */
export function callLabel(startedAt: number, now = new Date()): string {
  const date = new Date(startedAt)
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })
  const days = Math.round(
    (startOfDay(now) - startOfDay(date)) / (24 * 60 * 60 * 1000)
  )
  if (days === 0) return `Today, ${time}`
  if (days === 1) return `Yesterday, ${time}`
  const day = date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  })
  return `${day}, ${time}`
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}
