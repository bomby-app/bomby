// The transcript lines the page is still saving, per call, so ending a call can wait for
// them before its saved transcript is read: a read that overtook the last write would
// show, and keep (`saved-call-view.tsx`), the call without its last lines.

const writing = new Map<number, Promise<unknown>>()

/** The longest ending a call waits for its lines, so a stuck save can't hold it open. */
const MOST_WAIT_MS = 2000

/** Notes a line being saved for `callId`. */
export function track(callId: number, write: Promise<unknown>) {
  const before = writing.get(callId) ?? Promise.resolve()
  const all = Promise.allSettled([before, write])
  writing.set(callId, all)
  // Forgotten once nothing newer is pending.
  void all.then(() => {
    if (writing.get(callId) === all) writing.delete(callId)
  })
}

/** Resolves once every line noted so far for `callId` is saved or failed, or after the cap. */
export function written(
  callId: number,
  mostWaitMs = MOST_WAIT_MS
): Promise<void> {
  const pending = writing.get(callId)
  if (!pending) return Promise.resolve()
  return Promise.race([
    pending.then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, mostWaitMs)),
  ])
}
