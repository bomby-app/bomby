import { use } from "react"

import { AgentChatTranscript } from "@/components/agents-ui/agent-chat-transcript"
import { ErrorCard } from "@/components/error-card"

import { callMessages, type SavedMessage } from "./api"
import { toReceived } from "./transcript"

type Loaded = { messages: SavedMessage[] } | { error: string }

// Each past call's lines, read once for the page's life: `use` needs the same promise on
// every render, and opening the call again is instant. A call's entry goes when it opens
// as a live call (`forgetSavedCall`), since a resumed call grows and SQLite may give a new
// call a deleted one's id.
const loads = new Map<number, Promise<Loaded>>()

function load(callId: number): Promise<Loaded> {
  let loading = loads.get(callId)
  if (!loading) {
    loading = callMessages(callId).then(
      (messages) => ({ messages }),
      (e: unknown) => ({ error: String(e) })
    )
    loads.set(callId, loading)
  }
  return loading
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
  if ("error" in loaded)
    return <ErrorCard message={loaded.error} className="m-6" />
  if (loaded.messages.length === 0)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Nothing was said on this call.
      </p>
    )
  return (
    <AgentChatTranscript
      messages={loaded.messages.map(toReceived)}
      defaultScrollPosition="start"
      className="call-transcript min-h-0 flex-1"
    />
  )
}
