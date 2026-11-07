import { createStore, type Store, useStore } from "@/lib/store"

import { listTodos, onTodosChanged, type Todo } from "./api"

// Each project's to-dos for this page, read from the core when first shown and again
// whenever any window, or Bomby, changes them (`todos-changed`). Kept after the panel
// closes, so it reopens at once.

type Reading = { todos: Todo[] | null; error: string | null }

const stores = new Map<number, Store<Reading>>()
let following = false

function read(projectId: number) {
  const store = stores.get(projectId)
  if (!store) return
  listTodos(projectId).then(
    (todos) => store.set({ todos, error: null }),
    (e: unknown) => store.set({ ...store.get(), error: String(e) })
  )
}

function storeFor(projectId: number): Store<Reading> {
  let store = stores.get(projectId)
  if (!store) {
    store = createStore<Reading>({ todos: null, error: null }, () => {
      if (!following) {
        following = true
        void onTodosChanged(read)
      }
      read(projectId)
    })
    stores.set(projectId, store)
  }
  return store
}

/** The project's to-dos in the order they were added: null until first read. */
export function useTodos(projectId: number): Reading {
  return useStore(storeFor(projectId))
}
