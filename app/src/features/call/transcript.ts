import type { ReceivedMessage } from "@livekit/components-react"
import type { Participant } from "livekit-client"

import { callLabel, callLength } from "@/features/projects/names"

import type { CallSession, SavedMessage, Transcript } from "./api"

/**
 * A live line's lasting id. LiveKit sends each spoken segment as an interim stream, then a
 * final one, sharing `lk.segment_id` (`ParticipantAgentAttributes.TranscriptionSegmentId` in
 * `@livekit/components-core`). Its merged message takes the latest stream's `id`, so `id`
 * changes as the line settles: keyed on this, a line is saved once and keeps its row in the
 * transcript (docs/livekit-notes.md).
 */
export function lineId(message: ReceivedMessage): string {
  return message.attributes?.["lk.segment_id"] ?? message.id
}

/**
 * "user" or "agent" for a live line: a spoken transcript, or a chat message typed in the
 * control bar (the user's own) or sent back as chat. Null when it has no sender.
 */
export function roleOf(message: ReceivedMessage): "user" | "agent" | null {
  if (message.type === "userTranscript") return "user"
  if (message.type === "agentTranscript") return "agent"
  if (!message.from) return null
  return message.from.isLocal ? "user" : "agent"
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

/** One session of a call in its transcript: the session, and its lines as Agents UI has them. */
export type SessionLines = {
  session: CallSession
  /** It's the call's first session, the one it started with, said anything or not. */
  first: boolean
  lines: ReceivedMessage[]
}

/**
 * A saved call's sessions with their lines, in order. One where nothing was said is left
 * out, but each one kept still knows whether it was the call's first: a call whose first
 * opening was silent starts its transcript with a resume.
 */
export function bySession({ sessions, messages }: Transcript): SessionLines[] {
  const lines = new Map<number, ReceivedMessage[]>()
  for (const message of messages) {
    const said = lines.get(message.sessionId) ?? []
    said.push(toReceived(message))
    lines.set(message.sessionId, said)
  }
  return sessions.flatMap((session, index) => {
    const said = lines.get(session.id)
    return said ? [{ session, first: index === 0, lines: said }] : []
  })
}

/** What the pill over a session says, each part with its own icon. */
export type SessionLabel = {
  /** "Started" for the call's first session, "Resumed" for each after it. */
  kind: "Started" | "Resumed"
  /** When it started: "Today, 21:40". */
  when: string
  /** How long it was on: "12 min"; null for one that never ended (the app quit during it). */
  length: string | null
}

export function sessionLabel(
  session: CallSession,
  first: boolean,
  now = new Date()
): SessionLabel {
  return {
    kind: first ? "Started" : "Resumed",
    when: callLabel(session.startedAt, now),
    length:
      session.endedAt === null
        ? null
        : callLength(session.endedAt - session.startedAt),
  }
}
