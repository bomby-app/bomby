import { Channel } from "@tauri-apps/api/core"

import type { StreamEvent } from "@/generated/agent-streams"
import { call } from "@/lib/core"
import { log } from "@/lib/log"

/**
 * Follows the running streams of call `callId` (agent_streams.rs): `onEvent` gets the
 * events the core holds so far, then each one as it comes. Resolves to the function that
 * stops following. A watch the core starts after the page gave up waiting is stopped as
 * soon as its id arrives: nothing shows it, and the core would hold the call's streams
 * for it until Bomby quits.
 */
export async function watchAgentStreams(
  callId: number,
  onEvent: (event: StreamEvent) => void
): Promise<() => void> {
  const events = new Channel<StreamEvent>()
  events.onmessage = onEvent
  const id = await call<number>(
    "watch_agent_streams",
    { callId, events },
    { late: unwatch }
  )
  return () => unwatch(id)
}

function unwatch(id: number) {
  void call("unwatch_agent_streams", { id }).catch((e: unknown) =>
    log(`unwatch_agent_streams: ${String(e)}`)
  )
}
