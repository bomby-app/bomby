import { createStore, type Store, useStore } from "@/lib/store"

import { listTodos, onTodosChanged, type Todo } from "./api"

// Each project's to-dos for this page, read from the core when first shown and again
// whenever any window, or Bomby, changes them (`todos-changed`). Kept after the panel
// closes, so it reopens at once.

type Reading = { todos: Todo[] | null; error: string | null }

type Slot = {
  store: Store<Reading>
  /** A read is on its way. */
  running: boolean
  /** A change came while it was: read once more when it's done. */
  queued: boolean
}

const slots = new Map<number, Slot>()
let following: Promise<unknown> | null = null

/** Follows `todos-changed` from the first project shown; resolves once it's listening. */
function follow(): Promise<unknown> {
  // Without the event the list still shows; it just doesn't follow other windows.
  following ??= onTodosChanged(refresh).catch(() => undefined)
  return following
}

/**
 * Reads the project's to-dos again. One read at a time per project, and a change during
 * one queues one more, so answers land in order and the last always follows the last
 * change (as `workspace/readings.ts` does).
 */
function refresh(projectId: number) {
  const slot = slots.get(projectId)
  if (!slot) return
  if (slot.running) {
    slot.queued = true
    return
  }
  slot.running = true
  listTodos(projectId)
    .then(
      (todos) => slot.store.set({ todos, error: null }),
      (e: unknown) => slot.store.set({ ...slot.store.get(), error: String(e) })
    )
    .finally(() => {
      slot.running = false
      if (slot.queued) {
        slot.queued = false
        refresh(projectId)
      }
    })
}

function storeFor(projectId: number): Store<Reading> {
  let slot = slots.get(projectId)
  if (!slot) {
    // Listening before the first read, so no change between the two goes unseen.
    const store = createStore<Reading>({ todos: null, error: null }, () => {
      void follow().then(() => refresh(projectId))
    })
    slot = { store, running: false, queued: false }
    slots.set(projectId, slot)
  }
  return slot.store
}

/** Drops a deleted project's to-dos: SQLite may give a new project its id. */
export function forgetTodos(projectId: number) {
  slots.delete(projectId)
}

/** Nothing, never read: for a project without the extension. */
const NONE = createStore<Reading>({ todos: null, error: null })

/**
 * The project's to-dos in the order they were added: null until first read, and for no
 * project (`null`), when nothing is read.
 */
export function useTodos(projectId: number | null): Reading {
  return useStore(projectId === null ? NONE : storeFor(projectId))
}
