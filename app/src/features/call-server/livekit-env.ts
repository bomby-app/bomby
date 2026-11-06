/** The three LiveKit values, as LiveKit Cloud's "Environment variables" box gives them. */
export type LiveKitEnv = { url: string; apiKey: string; apiSecret: string }

const NAMES = {
  LIVEKIT_URL: "url",
  LIVEKIT_API_KEY: "apiKey",
  LIVEKIT_API_SECRET: "apiSecret",
} as const

/**
 * Reads `LIVEKIT_URL=...`, `LIVEKIT_API_KEY=...` and `LIVEKIT_API_SECRET=...` lines, in any
 * order, with or without `export ` and quotes; other lines are ignored. Null unless all
 * three are there.
 */
export function parseLiveKitEnv(text: string): LiveKitEnv | null {
  const found: Partial<LiveKitEnv> = {}
  for (const raw of text.split(/\r?\n/)) {
    const match = raw.trim().match(/^(?:export\s+)?([A-Z_]+)\s*=\s*(.*)$/)
    if (!match) continue
    const field = NAMES[match[1] as keyof typeof NAMES]
    const value = match[2].trim().replace(/^(['"])(.*)\1$/, "$2")
    if (field && value) found[field] = value
  }
  const { url, apiKey, apiSecret } = found
  return url && apiKey && apiSecret ? { url, apiKey, apiSecret } : null
}
