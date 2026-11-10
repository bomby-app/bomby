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

/**
 * A to-do being written in the dialog. `announce` when it was opened from outside the
 * panel (the command palette), so adding it says so, since the list may not be in view.
 */
export type Composing = Words & { announce: boolean }

type TodosViewState = {
  search: string
  filter: Filter
  showDone: boolean
  /** The one to-do being edited, if any. */
  draft: Draft | null
  /** The words in the field that adds one. */
  adding: string
  /** A to-do being written in the dialog that adds one with notes, while it's open. */
  composing: Composing | null
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

/**
 * Opens the dialog that adds a to-do with notes, from outside the panel, keeping one
 * already being written.
 */
export function composeTodo(projectId: number) {
  const store = storeFor(projectId)
  const state = store.get()
  if (!state.composing)
    store.set({ ...state, composing: { title: "", notes: "", announce: true } })
}

/**
 * What's kept once a save of `submitted` finishes: nothing if it's still what's being
 * edited, else what the user has gone on to (a save can finish after its editor closed
 * and another opened).
 */
export function afterSave<T>(current: T | null, submitted: T): T | null {
  return current === submitted ? null : current
}

/**
 * Ends editing `submitted` (the to-do being edited, or the one being written in the
 * dialog) once its save finishes, with `also` changed alongside; nothing if the user has
 * moved on to another meanwhile. Every edit replaces the object, so it's the same one only
 * if nothing changed since the save began.
 */
export function settle<K extends "draft" | "composing">(
  projectId: number,
  key: K,
  submitted: NonNullable<TodosViewState[K]>,
  also: Partial<TodosViewState> = {}
) {
  const store = storeFor(projectId)
  const state = store.get()
  if (afterSave(state[key], submitted) !== null) return
  store.set({ ...state, [key]: null, ...also })
}

/** Drops a deleted project's panel state. */
export function forgetViewState(projectId: number) {
  stores.delete(projectId)
}
