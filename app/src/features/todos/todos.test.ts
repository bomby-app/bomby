import { describe, expect, it } from "vite-plus/test"

import { MAX_ANSWER_BYTES } from "@/features/extensions/rpc"

import type { Todo } from "./api"
import { found, matches } from "./filters"
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
