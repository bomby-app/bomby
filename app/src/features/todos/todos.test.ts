import { describe, expect, it } from "vite-plus/test"

import { MAX_ANSWER_BYTES } from "@/features/extensions/rpc"

import type { Todo } from "./api"
import { found, matches } from "./filters"
import { bombyLine, ordered } from "./labels"
import { fit } from "./rpc"

function todo(number: number, changes: Partial<Todo> = {}): Todo {
  return {
    number,
    title: `To-do ${number}`,
    notes: "",
    status: "todo",
    createdBy: "user",
    updatedBy: "user",
    createdAt: 0,
    updatedAt: 0,
    doneAt: null,
    ...changes,
  }
}

describe("to-do filters", () => {
  it("open is to do and doing", () => {
    const statuses = ["todo", "doing", "done", "cancelled"] as const
    const todos = statuses.map((status, i) => todo(i + 1, { status }))
    expect(
      todos.filter((t) => matches(t, "open")).map((t) => t.status)
    ).toEqual(["todo", "doing"])
    expect(todos.filter((t) => matches(t, "all"))).toHaveLength(4)
    expect(todos.filter((t) => matches(t, "done"))).toHaveLength(1)
  })

  it("a search finds every word, in the title or notes, any case", () => {
    const reminders = todo(1, {
      title: "Fix the watering reminders",
      notes: "Only on iOS",
    })
    expect(found(reminders, "WATERING ios")).toBe(true)
    expect(found(reminders, "watering android")).toBe(false)
    expect(found(reminders, "  ")).toBe(true)
  })
})

describe("to-dos for Bomby", () => {
  it("keep the newest that fit in one answer", () => {
    const long = "x".repeat(1900)
    const todos = Array.from({ length: 20 }, (_, i) =>
      todo(i + 1, { notes: long })
    )
    const kept = fit(todos)
    expect(kept.length).toBeLessThan(20)
    expect(kept.at(-1)?.number).toBe(20)
    expect(
      new TextEncoder().encode(JSON.stringify(kept)).length
    ).toBeLessThanOrEqual(MAX_ANSWER_BYTES)
  })
})

describe("to-do labels", () => {
  const now = new Date(2026, 10, 8, 12, 0).getTime()

  it("say when Bomby changed a to-do last, and nothing for the user's own", () => {
    const added = todo(1, {
      updatedBy: "bomby",
      createdAt: now,
      updatedAt: now,
    })
    expect(bombyLine(added, now)).toBe("Bomby added it · just now")
    const ticked = todo(2, {
      updatedBy: "bomby",
      status: "done",
      updatedAt: now - 5 * 60_000,
      doneAt: now - 5 * 60_000,
    })
    expect(bombyLine(ticked, now)).toBe("Bomby ticked it off · 5 min ago")
    const changed = todo(3, {
      updatedBy: "bomby",
      updatedAt: now - 3 * 3_600_000,
    })
    expect(bombyLine(changed, now)).toBe("Bomby changed it · 3 hr ago")
    expect(bombyLine(todo(4), now)).toBeNull()
  })

  it("list open ones as added and closed ones the latest first", () => {
    const todos = [
      todo(1, { status: "done", doneAt: 10 }),
      todo(2),
      todo(3, { status: "done", doneAt: 30 }),
      todo(4),
    ]
    expect(ordered(todos, "todo").map((t) => t.number)).toEqual([2, 4])
    expect(ordered(todos, "done").map((t) => t.number)).toEqual([3, 1])
  })
})
