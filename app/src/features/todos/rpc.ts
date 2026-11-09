import {
  type ExtensionRpc,
  MAX_ANSWER_BYTES,
  record,
  Refusal,
} from "@/features/extensions/rpc"

import {
  addTodos,
  listTodos,
  removeTodo,
  type Todo,
  type TodoChange,
  type TodoStatus,
  updateTodo,
} from "./api"
import { isFilter, matches } from "./filters"

// What Bomby's to-do tools ask this page over RPC (`agent/extensions/todos.py`): the same
// commands the panel uses, as Bomby. The core checks every change; this only reads the
// request's shape.

const STATUSES: TodoStatus[] = ["todo", "doing", "done", "cancelled"]

/** What Bomby reads of a to-do. */
type TodoLine = Pick<Todo, "number" | "title" | "notes" | "status">

function line({ number, title, notes, status }: Todo): TodoLine {
  return { number, title, notes, status }
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new Refusal("Name the to-do by its number.")
  return value
}

function text(value: unknown, what: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "string") throw new Refusal(`The ${what} must be words.`)
  return value
}

/** What `todos.list` answers (`Listing` in `agent/extensions/todos.py`). */
export type Listing = { todos: TodoLine[]; omitted: number }

/**
 * The newest that fit in one answer, oldest first, and how many older ones were left out:
 * LiveKit's RPC carries at most 15 KiB, so a long list or long notes leave out the oldest,
 * and Bomby says so.
 */
export function fit(todos: TodoLine[]): Listing {
  const encoder = new TextEncoder()
  const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length
  // The answer without its to-dos, counting the most digits `omitted` can take.
  let size = bytes({ todos: [], omitted: todos.length })
  let first = todos.length
  while (first > 0) {
    // Each to-do with the comma before it.
    const next = bytes(todos[first - 1]) + 1
    if (size + next > MAX_ANSWER_BYTES) break
    size += next
    first -= 1
  }
  return { todos: todos.slice(first), omitted: first }
}

export const TODOS_RPC: ExtensionRpc = {
  id: "todos",
  handlers: {
    list: async (payload, { projectId }) => {
      const { status = "open" } = record(payload)
      if (!isFilter(status)) throw new Refusal("That's not a status I know.")
      const todos = await listTodos(projectId)
      return fit(todos.filter((t) => matches(t, status)).map(line))
    },
    add: async (payload, { projectId }) => {
      const { items } = record(payload)
      if (!Array.isArray(items)) throw new Refusal("Say what to add.")
      const added = await addTodos(
        projectId,
        items.map((item) => {
          const { title, notes } = record(item)
          return {
            title: text(title, "to-do") ?? "",
            notes: text(notes, "notes"),
          }
        }),
        "bomby"
      )
      return added.map(line)
    },
    update: async (payload, { projectId }) => {
      const request = record(payload)
      const { status } = request
      if (status !== undefined && !STATUSES.includes(status as TodoStatus))
        throw new Refusal("That's not a status I know.")
      const change: TodoChange = {
        title: text(request.title, "title"),
        notes: text(request.notes, "notes"),
        status: status as TodoStatus | undefined,
      }
      return line(
        await updateTodo(projectId, number(request.number), change, "bomby")
      )
    },
    remove: async (payload, { projectId }) =>
      line(await removeTodo(projectId, number(record(payload).number))),
  },
}
