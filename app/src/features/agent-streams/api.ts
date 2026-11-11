import { Channel } from "@tauri-apps/api/core"

import type { StreamEvent } from "@/generated/agent-streams"
import { call } from "@/lib/core"
import { log } from "@/lib/log"

/**
 * Follows the running streams of call `callId` (agent_streams.rs): `onEvent` gets the
 * events the core holds so far, then each one as it comes. Resolves to the function that
 * stops following.
 */
export async function watchAgentStreams(
  callId: number,
  onEvent: (event: StreamEvent) => void
): Promise<() => void> {
  const events = new Channel<StreamEvent>()
  events.onmessage = onEvent
  const id = await call<number>("watch_agent_streams", { callId, events })
  return () => {
    void call("unwatch_agent_streams", { id }).catch((e: unknown) =>
      log(`unwatch_agent_streams: ${String(e)}`)
    )
  }
}
