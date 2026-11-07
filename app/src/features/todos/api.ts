import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

import type {
  Author,
  NewTodo,
  Todo,
  TodoChange,
  TodosChanged,
} from "@/generated/todos"

// The core's to-do commands (src-tauri/src/extensions/todos.rs), for the user in the panel
// and for Bomby over RPC (`rpc.ts`). Each change tells every window (`onTodosChanged`).

export type {
  Author,
  NewTodo,
  Todo,
  TodoChange,
  TodoStatus,
} from "@/generated/todos"

/** The project's to-dos in the order they were added. */
export function listTodos(projectId: number): Promise<Todo[]> {
  return invoke("list_todos", { projectId })
}

/** Resolves to those added, in order. */
export function addTodos(
  projectId: number,
  items: NewTodo[],
  by: Author
): Promise<Todo[]> {
  return invoke("add_todos", { projectId, items, by })
}

export function updateTodo(
  projectId: number,
  number: number,
  change: TodoChange,
  by: Author
): Promise<Todo> {
  return invoke("update_todo", { projectId, number, change, by })
}

/** Resolves to the to-do removed. */
export function removeTodo(projectId: number, number: number): Promise<Todo> {
  return invoke("remove_todo", { projectId, number })
}

/** A project's to-dos changed, in any window. Returns the unlisten. */
export function onTodosChanged(
  handler: (projectId: number) => void
): Promise<UnlistenFn> {
  return listen<TodosChanged>("todos-changed", (event) =>
    handler(event.payload.projectId)
  )
}
