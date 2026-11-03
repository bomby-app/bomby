import type { AgentState } from "@livekit/components-react"

/** What the call screen says for each agent state, in the brand's voice (docs/brand.md). */
export function agentStatus(state: AgentState): string {
  switch (state) {
    case "connecting":
    case "initializing":
    case "pre-connect-buffering":
      return "Waking up..."
    case "listening":
    case "idle":
      return "Listening"
    case "thinking":
      return "Thinking"
    case "speaking":
      return "Talking"
    case "failed":
      return "Lost the connection. Try again?"
    case "disconnected":
      return "Talk soon."
  }
}
