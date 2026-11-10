// A call the voice model's service ended (no credits left, a key that stopped working).
// LiveKit closes the agent's session but leaves the agent in the room, so nothing else
// tells the page: the voice agent says why in one attribute on its own participant
// (agent/call_failure.py), and the page shows the line and ends the call.

/** What the voice agent sets when the voice model ends the call. */
const ATTRIBUTE = "bomby.failure"

/** Why the voice model ended the call, in a line for the user; null while it hasn't. */
export function callFailure(attributes: Record<string, string>): string | null {
  const line = attributes[ATTRIBUTE]?.trim()
  return line ? line : null
}
