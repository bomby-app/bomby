import {
  useEffect,
  useEffectEvent,
  useState,
  useSyncExternalStore,
} from "react"

import { watchFolder } from "./api"
import { type Reading, readings } from "./readings"

export type { Reading } from "./readings"

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

/**
 * Reads `load()` for `key` from the core when the component mounts and again whenever
 * `version` changes, showing the last answer meanwhile (`readings.ts` keeps them).
 * `key` names what `load` reads.
 */
export function useReading<T>(
  key: string,
  version: number,
  load: () => Promise<T>
): Reading<T> {
  const value = useSyncExternalStore(
    (listener) => readings.subscribe(key, listener),
    () => readings.snapshot(key)
  )
  // The loader of the render that asks, so a read queued behind a running one still reads
  // what `key` names, even once the component has moved on to another key.
  const loaderNow = useEffectEvent(() => load)
  useEffect(() => {
    readings.refresh(key, loaderNow())
  }, [key, version])
  return value as Reading<T>
}
