// Readings of the core (a folder's changes, a directory's entries, a file's preview),
// shared by every component that shows one and kept after they unmount, so reopening a
// folder or a tab shows the last answer at once while a fresh one loads
// (docs/frontend-notes.md, React patterns). React reads them through `useReading`
// (use-folder.ts); this module is the cache itself.

export type Reading<T> = {
  /** The last answer, kept while a newer one loads. */
  data: T | undefined
  error: string | null
  /** Nothing read for this key yet. */
  loading: boolean
}

const EMPTY: Reading<never> = { data: undefined, error: null, loading: true }

type Slot = {
  value: Reading<unknown>
  listeners: Set<() => void>
  /** A read is on its way. */
  running: boolean
  /** A read asked for while one was running: it runs once that one is done. */
  queued: (() => Promise<unknown>) | null
  /** When it was last shown or read, for dropping the longest unused first. */
  touched: number
}

type Readings = {
  snapshot: (key: string) => Reading<unknown>
  subscribe: (key: string, listener: () => void) => () => void
  /**
   * Reads `key` again with `load`. While a read is running, asking again queues one more
   * (the latest `load`), however many times it's asked: never two reads of one thing at
   * once, and never a read that misses the last change.
   */
  refresh: (key: string, load: () => Promise<unknown>) => void
}

/** A cache that keeps up to `idle` readings nobody shows, dropping the least recent. */
export function createReadings({
  idle = 64,
}: { idle?: number } = {}): Readings {
  const slots = new Map<string, Slot>()
  let clock = 0

  function slot(key: string): Slot {
    let found = slots.get(key)
    if (!found) {
      found = {
        value: EMPTY,
        listeners: new Set(),
        running: false,
        queued: null,
        touched: 0,
      }
      slots.set(key, found)
    }
    found.touched = ++clock
    return found
  }

  function prune() {
    const unused = [...slots.entries()].filter(
      ([, s]) => s.listeners.size === 0 && !s.running
    )
    if (unused.length <= idle) return
    unused.sort(([, a], [, b]) => a.touched - b.touched)
    for (const [key] of unused.slice(0, unused.length - idle)) slots.delete(key)
  }

  function publish(found: Slot, value: Reading<unknown>) {
    found.value = value
    for (const listener of found.listeners) listener()
  }

  function run(key: string, load: () => Promise<unknown>) {
    const found = slot(key)
    found.running = true
    load()
      .then(
        (data) => publish(found, { data, error: null, loading: false }),
        (error: unknown) =>
          publish(found, {
            data: undefined,
            error: String(error),
            loading: false,
          })
      )
      .finally(() => {
        found.running = false
        const next = found.queued
        found.queued = null
        if (next) run(key, next)
        else prune()
      })
  }

  return {
    snapshot: (key) => slot(key).value,
    subscribe: (key, listener) => {
      const found = slot(key)
      found.listeners.add(listener)
      return () => {
        found.listeners.delete(listener)
        prune()
      }
    },
    refresh: (key, load) => {
      const found = slot(key)
      if (found.running) found.queued = load
      else run(key, load)
    },
  }
}

/** The page's readings. */
export const readings = createReadings()
