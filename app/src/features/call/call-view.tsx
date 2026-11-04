import {
  useAgent,
  useLocalParticipant,
  useSessionContext,
  useSessionMessages,
  useTrackVolume,
} from "@livekit/components-react"
import type { LocalAudioTrack } from "livekit-client"
import { AnimatePresence, type MotionProps, motion } from "motion/react"
import { useMemo, useState } from "react"

import { AgentAudioVisualizerBar } from "@/components/agents-ui/agent-audio-visualizer-bar"
import { AgentChatTranscript } from "@/components/agents-ui/agent-chat-transcript"
import { AgentControlBar } from "@/components/agents-ui/agent-control-bar"
import { Mascot, mascotState } from "@/components/mascot"
import { cn } from "@/lib/utils"

import { agentStatus } from "./agent-status"
import type { ActiveCall } from "./call-provider"
import { lineId, toReceived } from "./transcript"

const FADE_IN: MotionProps = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { delay: 0.2, ease: "easeOut", duration: 0.3 },
  },
  exit: { opacity: 0, transition: { ease: "easeOut", duration: 0.3 } },
}

/**
 * The live call screen, laid out like LiveKit's agent-session-view-01 block (agent starter
 * app): the agent's visual in the middle, a transcript that opens over it, the status line
 * and LiveKit's control bar (mic with its device menu, transcript, leave) at the bottom.
 * The visual is Dot Dot with Agents UI's bar visualizer under it: the eyes say what the
 * agent is doing, the bars move with its voice.
 */
export function CallView({ call }: { call: ActiveCall }) {
  const session = useSessionContext()
  const agent = useAgent(session)
  const { messages: live } = useSessionMessages(session)
  // The session is reused across calls: keep this session's lines, after a resumed call's
  // saved ones. Each line keeps one id while it settles, which the scroller needs to follow
  // the live edge.
  const messages = useMemo(
    () => [
      ...call.history.map(toReceived),
      ...live
        .filter((m) => m.timestamp >= call.startedAt)
        .map((m) => ({ ...m, id: lineId(m) })),
    ],
    [call, live]
  )
  const [chatOpen, setChatOpen] = useState(false)

  return (
    <section className="relative h-full w-full overflow-hidden bg-background">
      <AnimatePresence>
        {chatOpen && (
          <motion.div
            {...FADE_IN}
            className="absolute inset-x-0 top-0 bottom-[156px] overflow-hidden"
          >
            <AgentChatTranscript
              agentState={agent.state}
              messages={messages}
              className="call-transcript h-full **:data-[slot=message-scroller-content]:pt-36!"
            />
            {/* Covers the agent at the top: bubbles scroll under it and fade out first. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-32 bg-linear-to-b from-background from-75% to-transparent" />
          </motion.div>
        )}
      </AnimatePresence>

      <AgentPresence compact={chatOpen} />

      <div className="absolute inset-x-6 bottom-0 z-20">
        <AnimatePresence mode="wait">
          <motion.output
            key={agent.state}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className={cn(
              "mx-auto block w-full max-w-2xl pb-3 text-center text-sm font-medium",
              agent.state === "connecting" ||
                agent.state === "initializing" ||
                agent.state === "pre-connect-buffering"
                ? "shimmer shimmer-duration-2000"
                : "text-muted-foreground"
            )}
          >
            {agentStatus(agent.state)}
          </motion.output>
        </AnimatePresence>
        <div className="call-controls mx-auto max-w-2xl bg-background pb-6">
          <AgentControlBar
            variant="livekit"
            controls={{
              leave: true,
              microphone: true,
              chat: true,
              camera: false,
              screenShare: false,
            }}
            // Follow the system's input and output; never remember a device.
            saveUserChoices={false}
            isChatOpen={chatOpen}
            isConnected={session.isConnected}
            onIsChatOpenChange={setChatOpen}
            onDisconnect={session.end}
          />
        </div>
      </div>
    </section>
  )
}

/**
 * The agent's visual: Dot Dot, eyes for the state and bubble breathing with whoever is
 * talking, over LiveKit's bar visualizer in the brand's primary colour (highlighter in
 * dark mode, ink in light: never highlighter on white). Moves to the top, smaller, while
 * the transcript is open.
 */
function AgentPresence({ compact }: { compact: boolean }) {
  const session = useSessionContext()
  const agent = useAgent(session)
  const { microphoneTrack } = useLocalParticipant()

  const micLevel = useTrackVolume(
    microphoneTrack?.audioTrack as LocalAudioTrack | undefined
  )
  const agentLevel = useTrackVolume(agent.microphoneTrack)

  const state = mascotState(agent.state)
  const level =
    state === "listening" ? micLevel : state === "speaking" ? agentLevel : 0

  return (
    <motion.div
      layout
      transition={{ type: "tween", ease: "easeOut", duration: 0.3 }}
      className={cn(
        "pointer-events-none absolute inset-x-0 z-20 flex justify-center",
        compact ? "top-4" : "top-0 bottom-[156px] items-center"
      )}
    >
      <div
        className={cn(
          "flex flex-col items-center",
          compact ? "gap-2" : "gap-6"
        )}
      >
        <Mascot state={state} level={level} size={compact ? 40 : 112} />
        <AgentAudioVisualizerBar
          size={compact ? "icon" : "sm"}
          barCount={5}
          state={agent.state}
          audioTrack={agent.microphoneTrack}
          className="text-primary"
        />
      </div>
    </motion.div>
  )
}
