import { describe, expect, it } from "vite-plus/test"

import type { StreamEvent } from "@/generated/agent-streams"

import {
  activity,
  type AgentStream,
  reduce,
  type Streams,
  took,
  toolLine,
  toolTitle,
  working,
} from "./streams"

const start: StreamEvent = {
  type: "start",
  stream: "1-1",
  agent: "claude",
  name: "Claude",
  session: "landing-page",
  at: 1000,
}

function play(...events: StreamEvent[]): Streams {
  return events.reduce(reduce, [])
}

const text = (
  t: string,
  message: string | null = "m1",
  stream = "1-1"
): StreamEvent => ({ type: "text", stream, message, text: t })

/** What the agent said and did, without the marks where its runs start and end. */
const body = (s: AgentStream) =>
  s.entries.filter((e) => e.kind !== "started" && e.kind !== "finished")

describe("reduce", () => {
  it("joins a message's pieces and starts a new one on a new id", () => {
    const [s] = play(start, text("Hel"), text("lo"), text("Next", "m2"))
    expect(body(s)).toMatchObject([
      { kind: "message", id: "m1", text: "Hello" },
      { kind: "message", id: "m2", text: "Next" },
    ])
  })

  it("continues a message without an id, and a tool call ends it", () => {
    const [s] = play(
      start,
      text("a", null),
      text("b"),
      { type: "tool", stream: "1-1", id: "t1", title: "Read x" },
      text("c")
    )
    expect(body(s).map((e) => e.kind)).toEqual(["message", "tool", "message"])
    expect(body(s)[0]).toMatchObject({ id: "m1", text: "ab" })
  })

  it("patches a tool call by id, keeping what an update leaves out", () => {
    const [s] = play(
      start,
      {
        type: "tool",
        stream: "1-1",
        id: "t1",
        title: "pnpm test",
        kind: "execute",
        status: "pending",
      },
      { type: "tool", stream: "1-1", id: "t1", status: "failed" }
    )
    expect(body(s)).toMatchObject([
      {
        kind: "tool",
        title: "pnpm test",
        toolKind: "execute",
        status: "error",
      },
    ])
    expect(s.steps).toBe(1)
  })

  it("starts a line for an update to a tool call it hasn't seen", () => {
    const [s] = play(start, {
      type: "tool",
      stream: "1-1",
      id: "t9",
      status: "completed",
    })
    expect(body(s)).toMatchObject([
      { kind: "tool", id: "t9", title: null, status: "done" },
    ])
  })

  it("reads an unknown status as running", () => {
    const [s] = play(start, {
      type: "tool",
      stream: "1-1",
      id: "t1",
      title: "Read x",
      status: "waiting",
    })
    expect(body(s)[0]).toMatchObject({ status: "running" })
  })

  it("closes every open tool call when the run ends, and keeps the run", () => {
    const streams = play(
      start,
      {
        type: "tool",
        stream: "1-1",
        id: "t1",
        title: "a",
        status: "in_progress",
      },
      { type: "tool", stream: "1-1", id: "t2", title: "b", status: "failed" },
      { type: "end", stream: "1-1", at: 9000 }
    )
    const [s] = streams
    expect(body(s)).toMatchObject([{ status: "done" }, { status: "error" }])
    expect(s.entries.at(0)).toMatchObject({ kind: "started", at: 1000 })
    expect(s.entries.at(-1)).toMatchObject({
      kind: "finished",
      at: 9000,
      took: 8000,
    })
    expect(working(s)).toBe(false)
    // Events after the end change nothing.
    expect(reduce(streams, text("late"))).toBe(streams)
  })

  it("continues the row when the same agent and session runs again", () => {
    const streams = play(
      start,
      { type: "tool", stream: "1-1", id: "t1", title: "a" },
      { type: "end", stream: "1-1", at: 2000 },
      { ...start, stream: "1-2", at: 5000 },
      // The same id as a call of the run before: it's this run's own.
      { type: "tool", stream: "1-2", id: "t1", title: "b" },
      text("done", "m1", "1-2")
    )
    expect(streams).toHaveLength(1)
    const [s] = streams
    expect(s.id).toBe("claude/landing-page")
    expect(s.entries.map((e) => e.kind)).toEqual([
      "started",
      "tool",
      "finished",
      "started",
      "tool",
      "message",
    ])
    expect(s.entries[1]).toMatchObject({ title: "a", status: "done" })
    expect(s.entries[4]).toMatchObject({ title: "b", status: "running" })
    expect(s.steps).toBe(2)
    expect(working(s)).toBe(true)
  })

  it("keeps each agent and session in a row of its own, in the order they started", () => {
    const streams = play(
      start,
      { ...start, stream: "1-2", session: "api" },
      { ...start, stream: "1-3", agent: "codex", name: "Codex" },
      { type: "end", stream: "1-1", at: 2000 }
    )
    expect(streams.map((s) => s.id)).toEqual([
      "claude/landing-page",
      "claude/api",
      "codex/landing-page",
    ])
    expect(streams.map(working)).toEqual([false, true, true])
  })

  it("shows one marker where events were dropped", () => {
    const [s] = play(
      start,
      text("a"),
      { type: "dropped", stream: "1-1" },
      { type: "dropped", stream: "1-1" },
      text("b")
    )
    expect(body(s).map((e) => e.kind)).toEqual([
      "message",
      "dropped",
      "message",
    ])
  })

  it("ignores events of a run that never started, and a start it has already", () => {
    expect(play(text("x"))).toEqual([])
    const streams = play(start, text("a"))
    expect(reduce(streams, start)).toBe(streams)
  })

  it("gives each entry a key of its own", () => {
    const [s] = play(
      start,
      text("a"),
      { type: "tool", stream: "1-1", id: "t1", title: "x" },
      { type: "end", stream: "1-1", at: 2000 },
      { ...start, stream: "1-2", at: 3000 },
      text("b", "m2", "1-2")
    )
    expect(new Set(s.entries.map((e) => e.key)).size).toBe(s.entries.length)
  })
})

describe("activity", () => {
  it("says what the agent is on, for its row", () => {
    expect(activity(play(start)[0])).toBe("Getting started")
    expect(activity(play(start, text("a"))[0])).toBe("Writing")
    const running: StreamEvent = {
      type: "tool",
      stream: "1-1",
      id: "t1",
      title: "pnpm test",
      kind: "execute",
      status: "in_progress",
    }
    expect(activity(play(start, running)[0])).toBe("Running pnpm test")
    expect(
      activity(play(start, running, { ...running, status: "completed" })[0])
    ).toBe("Working")
    expect(
      activity(play(start, running, { type: "end", stream: "1-1", at: 2 })[0])
    ).toBe("Finished")
  })
})

describe("toolTitle", () => {
  const command = { title: "pnpm test", toolKind: "execute" }

  it("says a command's status in its words", () => {
    expect(toolTitle({ ...command, status: "running" })).toBe(
      "Running pnpm test"
    )
    expect(toolTitle({ ...command, status: "done" })).toBe("Ran pnpm test")
    expect(toolTitle({ ...command, status: "error" })).toBe(
      "Failed to run pnpm test"
    )
    // The command apart from the words, to set as code.
    expect(toolLine({ ...command, status: "done" })).toEqual({
      words: "Ran",
      command: "pnpm test",
    })
  })

  it("keeps a title that is already a sentence", () => {
    const read = { title: "Read login.ts", toolKind: "read" }
    expect(toolTitle({ ...read, status: "done" })).toBe("Read login.ts")
    expect(toolTitle({ ...read, status: "error" })).toBe(
      "Failed: Read login.ts"
    )
    expect(
      toolLine({ title: "Run tests", toolKind: "execute", status: "done" })
    ).toEqual({ words: "Run tests", command: null })
  })

  it("names an untitled call by its kind", () => {
    expect(
      toolTitle({ title: null, toolKind: "edit", status: "running" })
    ).toBe("Editing a file")
    expect(toolTitle({ title: " ", toolKind: null, status: "done" })).toBe(
      "Used a tool"
    )
  })
})

describe("took", () => {
  it("says how long a run took in a few characters", () => {
    expect(took(400)).toBe("0s")
    expect(took(8_000)).toBe("8s")
    expect(took(125_000)).toBe("2m 05s")
    expect(took(3_840_000)).toBe("1h 04m")
  })
})
