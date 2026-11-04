import { useEffect, useState } from "react"

import { AgentChatTranscript } from "@/components/agents-ui/agent-chat-transcript"

import { callMessages, type SavedMessage } from "./api"
import { toReceived } from "./transcript"

/** A past call's conversation, from the database, in the live call's transcript. */
export function SavedCallView({ callId }: { callId: number }) {
  const [saved, setSaved] = useState<SavedMessage[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    callMessages(callId).then(setSaved, (e: unknown) => setError(String(e)))
  }, [callId])

  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>
  if (saved?.length === 0)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Nothing was said on this call.
      </p>
    )
  return (
    <AgentChatTranscript
      messages={(saved ?? []).map(toReceived)}
      defaultScrollPosition="start"
      className="call-transcript min-h-0 flex-1"
    />
  )
}
