import type { Todo, TodoStatus } from "./api"

// Which to-dos show: in the panel's status filter, and in what Bomby asks for (`rpc.ts`).

export type Filter = "open" | "all" | TodoStatus

export const FILTERS: Filter[] = [
  "open",
  "all",
  "todo",
  "doing",
  "done",
  "cancelled",
]

export function isFilter(value: unknown): value is Filter {
  return FILTERS.includes(value as Filter)
}

export function matches(todo: Todo, filter: Filter): boolean {
  if (filter === "all") return true
  if (filter === "open")
    return todo.status === "todo" || todo.status === "doing"
  return todo.status === filter
}

/** Whether a search finds the to-do: every word, in its title or notes, any case. */
export function found(todo: Todo, search: string): boolean {
  const text = `${todo.title}\n${todo.notes}`.toLowerCase()
  return search
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word))
}
