import { use, useEffect } from "react"

import { ErrorCard } from "@/components/error-card"

import { callTranscript } from "./api"
import { SessionTranscript } from "./session-transcript"
import { bySession, type SessionLines } from "./transcript"

type Loaded = { sessions: SessionLines[] } | { error: string }

// Past calls' lines as read, so `use` gets the same promise on every render and opening
// one again is instant: the latest MOST_KEPT, and always those whose page is showing. A
// call's entry goes when it opens as a live call (`forgetSavedCall`), since a resumed call
// grows and SQLite may give a new call a deleted one's id; a failed read goes once its
// page closes, so the next opening tries again.
const MOST_KEPT = 20

type Entry = { promise: Promise<Loaded>; failed: boolean; showing: number }

/** Oldest first: each read moves its call to the end. */
const loads = new Map<number, Entry>()

function load(callId: number): Promise<Loaded> {
  let entry = loads.get(callId)
  if (entry) {
    loads.delete(callId)
  } else {
    const created: Entry = {
      failed: false,
      showing: 0,
      promise: callTranscript(callId).then(
        (transcript): Loaded => ({ sessions: bySession(transcript) }),
        (e: unknown): Loaded => {
          created.failed = true
          return { error: String(e) }
        }
      ),
    }
    entry = created
  }
  loads.set(callId, entry)
  return entry.promise
}

/** Drops the oldest calls past MOST_KEPT, never one whose page is showing. */
function trim() {
  for (const [callId, entry] of loads) {
    if (loads.size <= MOST_KEPT) return
    if (entry.showing === 0) loads.delete(callId)
  }
}

/** Drops what this page read of a call, which is about to change. */
export function forgetSavedCall(callId: number) {
  loads.delete(callId)
}

/**
 * A past call's conversation, from the database, in the live call's transcript. It
 * suspends until the lines are read, and the main window opens it in a transition, so the
 * page before it stays until it's ready, with no empty transcript between.
 */
export function SavedCallView({ callId }: { callId: number }) {
  const loaded = use(load(callId))
  useEffect(() => {
    const entry = loads.get(callId)
    if (!entry) return
    entry.showing += 1
    trim()
    return () => {
      entry.showing -= 1
      if (entry.failed && loads.get(callId) === entry) loads.delete(callId)
      trim()
    }
  }, [callId])
  if ("error" in loaded)
    return <ErrorCard message={loaded.error} className="m-6" />
  if (loaded.sessions.length === 0)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Nothing was said on this call.
      </p>
    )
  return (
    <SessionTranscript
      sessions={loaded.sessions}
      defaultScrollPosition="start"
      className="call-transcript min-h-0 flex-1"
    />
  )
}
