import { useSyncExternalStore } from "react"

/**
 * A value every component on the page shares, kept outside React and read with
 * `useStore` (react.dev, `useSyncExternalStore`). `subscribe` and `get` never change, and
 * `set` replaces the value rather than changing it, as React requires.
 */
export type Store<T> = {
  get: () => T
  set: (next: T) => void
  subscribe: (listener: () => void) => () => void
}

/**
 * A store starting at `initial`. `start` runs once, for the first subscriber: where a store
 * starts following the core (its events, a first read).
 */
export function createStore<T>(initial: T, start?: () => void): Store<T> {
  let value = initial
  let started = false
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next) => {
      value = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      if (!started) {
        started = true
        start?.()
      }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** The store's value; re-renders when it changes. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get)
}
