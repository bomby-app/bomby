// Ending a call, once at a time per call. A call can be told to end twice: a start that
// fails after the room connected ends the session, whose disconnect ends the call while
// the start ends it too. The core's end is safe to repeat, but the work (saving the last
// lines, ending the call, reading the tree) shouldn't run twice, and nothing waiting on it
// should see it fail: a failure goes to the log.

/**
 * Returns `end(callId, work)`, which runs `work` unless an end of the same call is
 * already running, in which case it waits on that one. It never rejects: a failure goes
 * to `onError`. Once it's over, the next end of the call (a resumed call) runs again.
 */
export function callEndings(onError: (callId: number, e: unknown) => void) {
  const running = new Map<number, Promise<void>>()
  return (callId: number, work: () => Promise<void>): Promise<void> => {
    const current = running.get(callId)
    if (current) return current
    const done = work()
      .catch((e: unknown) => onError(callId, e))
      .finally(() => running.delete(callId))
    running.set(callId, done)
    return done
  }
}
