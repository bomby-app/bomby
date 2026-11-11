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
 * starts following the core (its events, a first read). `remount` runs each time a
 * subscriber comes after none were left (a section opened again): where a store whose
 * first read failed reads again, so a screen never stays on an error it could recover from.
 */
export function createStore<T>(
  initial: T,
  start?: () => void,
  remount?: () => void
): Store<T> {
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
      } else if (listeners.size === 0) {
        remount?.()
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
