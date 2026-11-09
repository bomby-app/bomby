import { createStore, type Store, useStore } from "@/lib/store"

import type { Filter } from "./filters"

// What the user has going on in a project's To-dos panel, kept outside it for as long as
// the page lives: the panel unmounts when it closes or another panel takes the column, and
// a row being edited remounts when its status moves it to another group, and neither may
// cost the user their search, filter or unsaved words. A deleted project's state goes with
// it (`forgetViewState`), since SQLite may give a new project its id.

/** A to-do's words: its title and notes. */
export type Words = { title: string; notes: string }

/** A to-do being edited: its words as the user has them, and as they were when editing began. */
export type Draft = Words & {
  number: number
  /** Only what the user changed from these is saved, so Bomby's changes meanwhile stay. */
  was: Words
  /** In the dialog, with room for longer notes, rather than in its row. */
  expanded: boolean
}

export type TodosViewState = {
  search: string
  filter: Filter
  showDone: boolean
  /** The one to-do being edited, if any. */
  draft: Draft | null
  /** The words in the field that adds one. */
  adding: string
  /** A to-do being written in the dialog that adds one with notes, while it's open. */
  composing: Words | null
}

const INITIAL: TodosViewState = {
  search: "",
  filter: "open",
  showDone: false,
  draft: null,
  adding: "",
  composing: null,
}

const stores = new Map<number, Store<TodosViewState>>()

function storeFor(projectId: number): Store<TodosViewState> {
  let store = stores.get(projectId)
  if (!store) {
    store = createStore(INITIAL)
    stores.set(projectId, store)
  }
  return store
}

/** The project's panel state, and a setter that changes part of it. */
export function useTodosViewState(
  projectId: number
): [TodosViewState, (change: Partial<TodosViewState>) => void] {
  const store = storeFor(projectId)
  const state = useStore(store)
  return [state, (change) => store.set({ ...store.get(), ...change })]
}

/** Opens the dialog that adds a to-do with notes, keeping one already being written. */
export function composeTodo(projectId: number) {
  const store = storeFor(projectId)
  const state = store.get()
  if (!state.composing)
    store.set({ ...state, composing: { title: "", notes: "" } })
}

/** Drops a deleted project's panel state. */
export function forgetViewState(projectId: number) {
  stores.delete(projectId)
}
