import { useEffect, useEffectEvent, useState } from "react"

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
  /** The last answer for this key, kept while a newer one loads. */
  data: T | undefined
  error: string | null
  /** Nothing read for this key yet. */
  loading: boolean
}

/**
 * Reads `load()` for `key`, and again whenever `version` changes. A new key starts empty;
 * a new version keeps the last answer until the next one arrives, so nothing flickers.
 */
export function useReading<T>(
  key: string,
  version: number,
  load: () => Promise<T>
): Reading<T> {
  const [state, setState] = useState<{
    key: string
    data: T | undefined
    error: string | null
  } | null>(null)
  const read = useEffectEvent(load)

  useEffect(() => {
    let live = true
    read().then(
      (data) => {
        if (live) setState({ key, data, error: null })
      },
      (error: unknown) => {
        if (live) setState({ key, data: undefined, error: String(error) })
      }
    )
    return () => {
      live = false
    }
  }, [key, version])

  const current = state?.key === key ? state : null
  return {
    data: current?.data,
    error: current?.error ?? null,
    loading: current === null,
  }
}
