import type { Todo, TodoStatus } from "./api"
import type { Filter } from "./filters"

// What the panel says about to-dos, in the brand's voice (docs/brand.md).

export const STATUS_LABEL: Record<TodoStatus, string> = {
  todo: "To do",
  doing: "Doing",
  done: "Done",
  cancelled: "Cancelled",
}

export const FILTER_LABEL: Record<Filter, string> = {
  open: "Open",
  all: "All",
  ...STATUS_LABEL,
}

/** The groups the list shows, in order. */
export const GROUPS: TodoStatus[] = ["doing", "todo", "done", "cancelled"]

/** A group's to-dos in the order they show: open ones as added, the rest the latest first. */
export function ordered(todos: Todo[], status: TodoStatus): Todo[] {
  const group = todos.filter((t) => t.status === status)
  if (status === "todo" || status === "doing") return group
  const at = (t: Todo) => t.doneAt ?? t.updatedAt
  return group.sort((a, b) => at(b) - at(a))
}

/**
 * The line under a to-do Bomby changed last: who and when ("Bomby added it · just now").
 * Nothing for the user's own changes, which they made themselves.
 */
export function bombyLine(todo: Todo, now = Date.now()): string | null {
  if (todo.updatedBy !== "bomby") return null
  const what =
    todo.createdAt === todo.updatedAt
      ? "added it"
      : todo.status === "done" && todo.doneAt === todo.updatedAt
        ? "ticked it off"
        : "changed it"
  return `Bomby ${what} · ${ago(todo.updatedAt, now)}`
}

/** "just now", "5 min ago", "2 hr ago", then the day: "Tuesday", "3 Nov". */
export function ago(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const date = new Date(at)
  if (hours < 24 * 6)
    return date.toLocaleDateString(undefined, { weekday: "long" })
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" })
}
