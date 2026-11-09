import { describe, expect, it } from "vite-plus/test"

import type { CallSession, SavedMessage } from "./api"
import { bySession, sessionLabel } from "./transcript"

const HOUR = 60 * 60 * 1000
const NOW = new Date(2026, 10, 9, 22, 0)
const today = (hour: number, minute = 0) =>
  new Date(2026, 10, 9, hour, minute).getTime()

function line(id: number, sessionId: number, text: string): SavedMessage {
  return { id, sessionId, role: "user", text, createdAt: id }
}

describe("a call's transcript by session", () => {
  it("keeps each line with its session, in order, and leaves out silent ones", () => {
    const sessions: CallSession[] = [
      { id: 1, startedAt: today(9), endedAt: today(10) },
      { id: 2, startedAt: today(11), endedAt: today(11, 5) },
      { id: 3, startedAt: today(12), endedAt: null },
    ]
    const groups = bySession({
      sessions,
      messages: [line(1, 1, "a"), line(2, 1, "b"), line(3, 3, "c")],
    })
    expect(
      groups.map((g) => [g.session.id, g.lines.map((l) => l.message)])
    ).toEqual([
      [1, ["a", "b"]],
      [3, ["c"]],
    ])
  })

  it("says when each started and how long it was on", () => {
    const session: CallSession = {
      id: 1,
      startedAt: today(21, 40),
      endedAt: today(21, 40) + HOUR + 12 * 60_000,
    }
    const time = new Date(session.startedAt).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    })
    expect(sessionLabel(session, true, NOW)).toBe(
      `Started Today, ${time} · 1 hr 12 min`
    )
    expect(sessionLabel({ ...session, endedAt: null }, false, NOW)).toBe(
      `Resumed Today, ${time}`
    )
  })
})
