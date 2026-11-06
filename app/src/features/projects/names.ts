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

/** How long a call ran: "Under a minute", "4 min", "1 hr 12 min". */
export function callLength(startedAt: number, endedAt: number): string {
  const minutes = Math.floor((endedAt - startedAt) / 60_000)
  if (minutes < 1) return "Under a minute"
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`
}

/** When something last happened, for the projects home: "2 hours ago", "Yesterday". */
export function timeAgo(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? "An hour ago" : `${hours} hours ago`
  const days = Math.round(
    (startOfDay(new Date(now)) - startOfDay(new Date(at))) /
      (24 * 60 * 60 * 1000)
  )
  if (days <= 1) return "Yesterday"
  if (days < 7) return `${days} days ago`
  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  })
}

/** A folder for display, with the home folder as "~": "~/code/plantpal". */
export function shortPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+(?=\/|$)/, "~")
}

/** "a", "a and b", "a, b and c". */
export function andList(names: string[]): string {
  if (names.length <= 1) return names.join("")
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
}
