import {
  useEffect,
  useEffectEvent,
  useState,
  useSyncExternalStore,
} from "react"

import { watchFolder } from "./api"

/**
 * A number that goes up each time something in the folder changes, so readings keyed on
 * it read again. Watches while the component is mounted.
 */
export function useFolderVersion(projectId: number, folder: string): number {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let live = true
    let stop: (() => void) | null = null
    watchFolder(projectId, folder, () => setVersion((v) => v + 1)).then(
      (unwatch) => {
        if (live) stop = unwatch
        else unwatch()
      },
      // Without a watch the panel still shows what it read; it only won't follow along.
      () => {}
    )
    return () => {
      live = false
      stop?.()
    }
  }, [projectId, folder])
  return version
}

export type Reading<T> = {
  /** The last answer, kept while a newer one loads. */
  data: T | undefined
  error: string | null
  /** Nothing read for this key yet. */
  loading: boolean
}

/**
 * One reading of the core (a folder's changes, a directory's entries), shared by every
 * component that shows it and kept after they unmount, so reopening a folder or a tab
 * shows the last answer at once while a fresh one loads (docs/frontend-notes.md, React
 * patterns). Only the newest request's answer lands.
 */
type Slot = {
  value: Reading<unknown>
  latest: number
  listeners: Set<() => void>
}

const EMPTY: Reading<never> = { data: undefined, error: null, loading: true }
const slots = new Map<string, Slot>()

function slot(key: string): Slot {
  let found = slots.get(key)
  if (!found) {
    found = { value: EMPTY, latest: 0, listeners: new Set() }
    slots.set(key, found)
  }
  return found
}

function publish(found: Slot, value: Reading<unknown>) {
  found.value = value
  for (const listener of found.listeners) listener()
}

function refresh(key: string, load: () => Promise<unknown>) {
  const found = slot(key)
  const request = ++found.latest
  load().then(
    (data) => {
      if (request === found.latest)
        publish(found, { data, error: null, loading: false })
    },
    (error: unknown) => {
      if (request === found.latest)
        publish(found, {
          data: undefined,
          error: String(error),
          loading: false,
        })
    }
  )
}

/**
 * Reads `load()` for `key` from the core when the component mounts and again whenever
 * `version` changes, showing the last answer meanwhile. `key` names what `load` reads.
 */
export function useReading<T>(
  key: string,
  version: number,
  load: () => Promise<T>
): Reading<T> {
  const found = slot(key)
  const value = useSyncExternalStore(
    (listener) => {
      found.listeners.add(listener)
      return () => found.listeners.delete(listener)
    },
    () => found.value
  )
  const read = useEffectEvent(load)
  useEffect(() => {
    refresh(key, () => read())
  }, [key, version])
  return value as Reading<T>
}
