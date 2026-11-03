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

import { AgentAudioVisualizerAura } from "@/components/agents-ui/agent-audio-visualizer-aura"
import { AgentChatTranscript } from "@/components/agents-ui/agent-chat-transcript"
import { AgentControlBar } from "@/components/agents-ui/agent-control-bar"
import { Mascot, mascotState } from "@/components/mascot"
import { useTheme } from "@/features/theme/theme-provider"
import { cn } from "@/lib/utils"
import { agentStatus } from "./agent-status"
import type { ActiveCall } from "./call-provider"
import { toReceived } from "./transcript"

// The highlighter (docs/brand.md): the one loud moment, the agent's glow.
const HIGHLIGHTER = "#E8FF3A"

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
 * The visual is Agents UI's Aura in highlighter with Dot Dot inside it, so the glow moves
 * with the voice and the eyes say what the agent is doing.
 */
export function CallView({ call }: { call: ActiveCall }) {
  const session = useSessionContext()
  const agent = useAgent(session)
  const { messages: live } = useSessionMessages(session)
  // The session is reused across calls: keep this session's lines, after a resumed call's
  // saved ones.
  const messages = useMemo(
    () => [
      ...call.history.map(toReceived),
      ...live.filter((m) => m.timestamp >= call.startedAt),
    ],
    [call, live]
  )
  const [chatOpen, setChatOpen] = useState(false)

  return (
    <section className="relative h-full w-full overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-x-4 top-0 z-10 h-24 bg-linear-to-b from-background to-transparent" />

      <AnimatePresence>
        {chatOpen && (
          <motion.div
            {...FADE_IN}
            className="absolute inset-x-0 top-0 bottom-[156px] overflow-hidden"
          >
            <AgentChatTranscript
              agentState={agent.state}
              messages={messages}
              className="call-transcript h-full **:data-[slot=message-scroller-content]:pt-28!"
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AgentPresence compact={chatOpen} />

      <div className="absolute inset-x-6 bottom-0 z-20">
        <AnimatePresence mode="wait">
          <motion.p
            key={agent.state}
            role="status"
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
          </motion.p>
        </AnimatePresence>
        <div className="mx-auto max-w-2xl bg-background pb-6">
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
 * The agent's visual: the Aura reacts to the agent's voice and state; Dot Dot sits in its
 * glow, eyes for the state, bubble breathing with whoever is talking. Moves to the top,
 * smaller, while the transcript is open.
 */
function AgentPresence({ compact }: { compact: boolean }) {
  const session = useSessionContext()
  const agent = useAgent(session)
  const { microphoneTrack } = useLocalParticipant()
  const { resolved } = useTheme()

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
        "pointer-events-none absolute inset-x-0 flex justify-center",
        compact ? "top-4" : "top-0 bottom-[156px] items-center"
      )}
    >
      <div className="relative grid place-items-center">
        <AgentAudioVisualizerAura
          size={compact ? "sm" : "lg"}
          state={agent.state}
          audioTrack={agent.microphoneTrack}
          color={HIGHLIGHTER}
          themeMode={resolved}
          className={compact ? "size-[88px]" : "size-[320px]"}
        />
        <Mascot
          state={state}
          level={level}
          size={compact ? 40 : 112}
          className="absolute"
        />
      </div>
    </motion.div>
  )
}
