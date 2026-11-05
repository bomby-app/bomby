import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"

import type { CallToken, Message as SavedMessage } from "@/generated/call"

// The core's call commands (src-tauri/src/calls.rs).

export type { CallToken, Message as SavedMessage } from "@/generated/call"

/**
 * Starts the agent if needed and opens a new call on the project, or reopens its earlier
 * call `resumeCallId`. Returns the call's id.
 */
export function openCall(
  projectId: number,
  resumeCallId?: number
): Promise<number> {
  return invoke("open_call", { projectId, resumeCallId: resumeCallId ?? null })
}

/**
 * A token that joins a new room for the call (the agent hears the call's last lines).
 * Only reads, so LiveKit may fetch one whenever it likes.
 */
export function callToken(callId: number): Promise<CallToken> {
  return invoke("call_token", { callId })
}

export function endCall(callId: number): Promise<void> {
  return invoke("end_call", { callId })
}

/** Saves one transcript line; saving the same segment again replaces its text. */
export function saveMessage(
  callId: number,
  line: { segmentId: string; role: "user" | "agent"; text: string }
): Promise<void> {
  return invoke("save_message", { callId, line })
}

/** Deletes a call and its conversation. */
export function deleteCall(callId: number): Promise<void> {
  return invoke("delete_call", { callId })
}

export function callMessages(callId: number): Promise<SavedMessage[]> {
  return invoke("call_messages", { callId })
}

/** A room's agent job crashed, with why (src-tauri/src/calls.rs, `AGENT_CRASHED`). */
export type AgentCrashed = { room: string; reason: string }

/** Calls `handler` when a call's agent job crashes. Returns the unlisten. */
export function onAgentCrashed(handler: (crash: AgentCrashed) => void) {
  return getCurrentWindow().listen<AgentCrashed>(
    "call-agent-crashed",
    (event) => handler(event.payload)
  )
}
