import type { ReceivedMessage } from "@livekit/components-react"
import type { Participant } from "livekit-client"

import type { SavedMessage } from "./api"

/** "user" or "agent" for a live transcript line; null for anything else (chat). */
export function roleOf(message: ReceivedMessage): "user" | "agent" | null {
  if (message.type === "userTranscript") return "user"
  if (message.type === "agentTranscript") return "agent"
  return null
}

/**
 * A saved line in the shape Agents UI's transcript renders, so a past call shows exactly
 * like a live one. The transcript only reads `from.isLocal` to put the user's lines on the
 * right, so that is all the stand-in participant carries.
 */
export function toReceived(saved: SavedMessage): ReceivedMessage {
  return {
    id: String(saved.id),
    timestamp: saved.createdAt,
    type: saved.role === "user" ? "userTranscript" : "agentTranscript",
    message: saved.text,
    from: { isLocal: saved.role === "user" } as Participant,
  }
}
