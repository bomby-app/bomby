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

/** A call's title: its name, or when it started until it has one. */
export function callTitle(call: { name: string | null; startedAt: number }) {
  return call.name ?? callLabel(call.startedAt)
}

/** How long a call was on, from its length in ms: "Under a minute", "4 min", "1 hr 12 min". */
export function callLength(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
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
