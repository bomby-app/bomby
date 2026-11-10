import { describe, expect, it } from "vite-plus/test"

import type { StreamEvent } from "@/generated/agent-streams"

import { reduce, running, type Streams, toolTitle } from "./streams"

const start: StreamEvent = {
  type: "start",
  stream: "1-1",
  agent: "claude",
  name: "Claude",
  session: "landing-page",
}

function play(...events: StreamEvent[]): Streams {
  return events.reduce(reduce, [])
}

const text = (t: string, message: string | null = "m1"): StreamEvent => ({
  type: "text",
  stream: "1-1",
  message,
  text: t,
})

describe("reduce", () => {
  it("joins a message's pieces and starts a new one on a new id", () => {
    const [s] = play(start, text("Hel"), text("lo"), text("Next", "m2"))
    expect(s.entries).toMatchObject([
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
    expect(s.entries.map((e) => e.kind)).toEqual(["message", "tool", "message"])
    expect(s.entries[0]).toMatchObject({ id: "m1", text: "ab" })
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
    expect(s.entries).toMatchObject([
      {
        kind: "tool",
        title: "pnpm test",
        toolKind: "execute",
        status: "error",
      },
    ])
  })

  it("starts a line for an update to a tool call it hasn't seen", () => {
    const [s] = play(start, {
      type: "tool",
      stream: "1-1",
      id: "t9",
      status: "completed",
    })
    expect(s.entries).toMatchObject([
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
    expect(s.entries[0]).toMatchObject({ status: "running" })
  })

  it("closes every open tool call when the turn ends, and the stream leaves the list", () => {
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
      { type: "end", stream: "1-1" }
    )
    expect(streams[0].entries).toMatchObject([
      { status: "done" },
      { status: "error" },
    ])
    expect(running(streams)).toEqual([])
    // Events after the end change nothing.
    expect(reduce(streams, text("late"))).toBe(streams)
  })

  it("shows one marker where events were dropped", () => {
    const [s] = play(
      start,
      text("a"),
      { type: "dropped", stream: "1-1" },
      { type: "dropped", stream: "1-1" },
      text("b")
    )
    expect(s.entries.map((e) => e.kind)).toEqual([
      "message",
      "dropped",
      "message",
    ])
  })

  it("ignores events of a stream that never started, and lets ended ones go", () => {
    expect(play(text("x"))).toEqual([])
    const streams = play(
      start,
      { type: "end", stream: "1-1" },
      { ...start, stream: "1-2", session: "api" }
    )
    expect(streams.map((s) => s.id)).toEqual(["1-2"])
  })

  it("gives each entry a key of its own", () => {
    const [s] = play(
      start,
      text("a"),
      { type: "tool", stream: "1-1", id: "t1", title: "x" },
      text("b", "m2")
    )
    expect(new Set(s.entries.map((e) => e.key)).size).toBe(3)
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
  })

  it("keeps a title that is already a sentence", () => {
    const read = { title: "Read login.ts", toolKind: "read" }
    expect(toolTitle({ ...read, status: "done" })).toBe("Read login.ts")
    expect(toolTitle({ ...read, status: "error" })).toBe(
      "Failed: Read login.ts"
    )
    expect(
      toolTitle({ title: "Run tests", toolKind: "execute", status: "done" })
    ).toBe("Run tests")
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
