/** Around each match in a call's snippet, as the core marks it (`MARK_START`, `MARK_END`). */
const MARK_START = "\u0002"
const MARK_END = "\u0003"

/** A snippet's text in parts, each saying whether it matched. */
export function snippetParts(
  snippet: string
): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = []
  for (const [index, piece] of snippet.split(MARK_START).entries()) {
    if (index === 0) {
      if (piece) parts.push({ text: piece, match: false })
      continue
    }
    const end = piece.indexOf(MARK_END)
    const [matched, rest] =
      end === -1 ? [piece, ""] : [piece.slice(0, end), piece.slice(end + 1)]
    if (matched) parts.push({ text: matched, match: true })
    if (rest) parts.push({ text: rest, match: false })
  }
  return parts
}
