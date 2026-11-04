import type { UnlistenFn } from "@tauri-apps/api/event"
import { useEffect, useEffectEvent } from "react"

/**
 * Calls `handler` for each of the core's events that `listen` subscribes to (a feature's
 * `onX` from its api.ts), while the component is mounted. `handler` always sees the latest
 * props and state; `listen` must not change between renders (a module-level function).
 */
export function useCoreEvent<A extends unknown[]>(
  listen: (handler: (...args: A) => void) => Promise<UnlistenFn>,
  handler: (...args: A) => void
) {
  const onEvent = useEffectEvent(handler)
  useEffect(() => {
    const stop = listen((...args) => onEvent(...args))
    return () => {
      void stop.then((unlisten) => unlisten())
    }
  }, [listen])
}
