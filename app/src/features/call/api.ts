import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"

import type {
  CallName,
  CallRenamed,
  CallToken,
  Namer,
  Transcript,
} from "@/generated/call"
import { call } from "@/lib/core"
import { log } from "@/lib/log"

// The core's call commands (src-tauri/src/calls.rs).

export type {
  CallName,
  CallSession,
  CallToken,
  Namer,
  Message as SavedMessage,
  Transcript,
} from "@/generated/call"

/**
 * Starts the agent if needed and opens a new call on the project, or reopens its earlier
 * call `resumeCallId`. Returns the call's id. A call the core opens after the page gave up
 * (Cancel, or the wait below running out) is ended as soon as its id arrives: nothing joins
 * it, and left open it would hold off an update's restart until Bomby quits.
 */
export function openCall(
  projectId: number,
  resumeCallId?: number
): Promise<number> {
  return call(
    "open_call",
    { projectId, resumeCallId: resumeCallId ?? null },
    // Starting the voice agent alone may take a minute (READY_TIMEOUT in agent.rs).
    {
      timeout: 120_000,
      late: (callId) => {
        void endCall(callId).catch((e: unknown) =>
          log(
            `Ending call ${callId}, opened after the start gave up, failed: ${String(e)}`
          )
        )
      },
    }
  )
}

/**
 * A token that joins a new room for the call (the agent hears the call's last lines).
 * Only reads, so LiveKit may fetch one whenever it likes.
 */
export function callToken(callId: number): Promise<CallToken> {
  return call("call_token", { callId })
}

export function endCall(callId: number): Promise<void> {
  return call("end_call", { callId })
}

/** Saves one transcript line; saving the same segment again replaces its text. */
export function saveMessage(
  callId: number,
  line: { segmentId: string; role: "user" | "agent"; text: string }
): Promise<void> {
  return call("save_message", { callId, line })
}

/** Deletes a call and its conversation. */
export function deleteCall(callId: number): Promise<void> {
  return call("delete_call", { callId })
}

/** A call's saved conversation: its sessions (each opening or resume) and its lines. */
export function callTranscript(callId: number): Promise<Transcript> {
  return call("call_transcript", { callId })
}

/**
 * Names the call, for the user or for Bomby; no words take its name away. Resolves to its
 * name as it is now, and tells every window (`onCallRenamed`).
 */
export function renameCall(
  callId: number,
  name: string,
  by: Namer
): Promise<CallName> {
  return call("rename_call", { callId, name, by })
}

/** A call was named or renamed, in any window. Returns the unlisten. */
export function onCallRenamed(
  handler: (renamed: CallRenamed) => void
): Promise<UnlistenFn> {
  return listen<CallRenamed>("call-renamed", (event) => handler(event.payload))
}

/** A room's agent job crashed, with why (src-tauri/src/calls.rs, `AGENT_CRASHED`). */
type AgentCrashed = { room: string; reason: string }

/** Calls `handler` when a call's agent job crashes. Returns the unlisten. */
export function onAgentCrashed(handler: (crash: AgentCrashed) => void) {
  return getCurrentWindow().listen<AgentCrashed>(
    "call-agent-crashed",
    (event) => handler(event.payload)
  )
}
