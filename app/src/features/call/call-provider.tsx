import {
  useAgent,
  useSession,
  useSessionContext,
  useSessionMessages,
} from "@livekit/components-react"
import { RoomEvent, TokenSource } from "livekit-client"
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"

import { AgentSessionProvider } from "@/components/agents-ui/agent-session-provider"
import { StartAudioButton } from "@/components/agents-ui/start-audio-button"
import { useCoreEvent } from "@/hooks/use-core-event"
import { log } from "@/lib/log"

import { useProjects } from "../projects/projects-provider"
import {
  callToken,
  callTranscript,
  endCall,
  onAgentCrashed,
  openCall,
  saveMessage,
} from "./api"
import { callEndings } from "./call-endings"
import { callFailure } from "./call-failure"
import { MuteShortcut } from "./mute"
import { forgetSavedCall } from "./saved-call-view"
import { bySession, lineId, roleOf, type SessionLines } from "./transcript"
import { track, written } from "./transcript-writes"

export type ActiveCall = {
  projectId: number
  callId: number
  /** When this session started; live lines from before it belong to an earlier session. */
  startedAt: number
  /** A resumed call's earlier sessions and their lines, shown above the live ones. */
  history: SessionLines[]
}

/** What a start is for: a project, and the call to resume if any. */
type CallRequest = { projectId: number; resumeCallId?: number }

type CallState = {
  /** The call the session is on, from its start until the session disconnects. */
  active: ActiveCall | null
  /** The call being started (or resumed) while the core gets the agent ready. */
  starting: CallRequest | null
  /** Why the last call failed to start or was cut off, and on which project. */
  error: { projectId: number; message: string } | null
  start: (projectId: number, resumeCallId?: number) => Promise<void>
  /** Gives up on the call being started; one the core opens meanwhile is ended. */
  cancel: () => void
}

const CallContext = createContext<CallState | null>(null)

/**
 * LiveKit fetches a token whenever it likes: on mount, on each start, and on end and
 * disconnects to have the next one ready. So the source only asks the core for a token for
 * the current call, and never opens one. A function, not `TokenSource.custom`, which caches
 * the token fetched at the end and would join the next call with the last call's metadata
 * (docs/livekit-notes.md).
 */
function callTokens() {
  // The call the session joins (and last joined: LiveKit may fetch a token after the end).
  let callId: number | null = null
  return {
    source: TokenSource.literal(async () => {
      if (callId === null) throw new Error("No call to join yet")
      return callToken(callId)
    }),
    /** Points the next tokens at this call. */
    join(id: number) {
      callId = id
    },
    current: () => callId,
  }
}

/**
 * The app's one LiveKit session, set up the way LiveKit's agent starter does: created once
 * at the top, started from the user's click, ended by the control bar (`session.end`). The
 * session context wraps the whole window, so the call screen and the sidebar can read it
 * anywhere, and the call keeps running while the user looks at other projects.
 *
 * The call row is ours: `start` opens it in the core before joining, and the room's
 * disconnect closes it, however the call ends.
 */
export function CallProvider({ children }: { children: ReactNode }) {
  const { refresh } = useProjects()
  const [active, setActive] = useState<ActiveCall | null>(null)
  const [starting, setStarting] = useState<CallRequest | null>(null)
  const [error, setError] = useState<CallState["error"]>(null)
  // One token source for the provider's life: the session must keep the same one.
  const [tokens] = useState(callTokens)
  const session = useSession(tokens.source, {
    agentConnectTimeoutMilliseconds: 30_000,
  })
  // Cancels the start in progress. With an agent in the token, `session.start` waits for the
  // agent to join with no timeout of its own, so a call that ends first (End call, a failed
  // or crashed agent) would leave it waiting, and the Call button disabled, for good
  // (@livekit/components-react 2.9.24, `useSession`'s `start`; docs/livekit-notes.md).
  const joining = useRef<AbortController | null>(null)

  // A failed start that had connected ends the call twice (its own end, and the room's
  // disconnect): the second waits on the first, and neither rejects.
  const [ending] = useState(() =>
    callEndings((id, e) => log(`Ending call ${id} failed: ${String(e)}`))
  )

  const finish = useCallback(
    (id: number) =>
      ending(id, async () => {
        // Its last lines are saved, and the call and its session ended, before the call's
        // page shows its saved transcript; only then is what this page kept of it dropped,
        // so the transcript read is whole, the last session's end included.
        await written(id)
        try {
          await endCall(id)
        } finally {
          forgetSavedCall(id)
          setActive((current) => (current?.callId === id ? null : current))
        }
        // The tree catches up; a read that fails must not hold up or fail the end.
        void refresh().catch((e: unknown) =>
          log(`Reading projects after call ${id} ended failed: ${String(e)}`)
        )
      }),
    [ending, refresh]
  )

  // However the call ends (End call, the room closing, the agent failing), the room
  // disconnects once: that closes the call.
  useEffect(() => {
    const onDisconnected = () => {
      joining.current?.abort()
      const id = tokens.current()
      if (id !== null) void finish(id)
    }
    session.room.on(RoomEvent.Disconnected, onDisconnected)
    return () => {
      session.room.off(RoomEvent.Disconnected, onDisconnected)
    }
  }, [session.room, finish, tokens])

  async function start(projectId: number, resumeCallId?: number) {
    setError(null)
    const request: CallRequest = { projectId, resumeCallId }
    setStarting(request)
    const aborter = new AbortController()
    joining.current = aborter
    let opened: number | null = null
    try {
      // Cancel (`cancel`) can come while the core opens the call or reads its lines,
      // neither of which it can stop: the start goes no further once they answer.
      opened = await openCall(projectId, resumeCallId)
      aborter.signal.throwIfAborted()
      tokens.join(opened)
      const history = resumeCallId
        ? bySession(await callTranscript(opened))
        : []
      aborter.signal.throwIfAborted()
      forgetSavedCall(opened)
      setActive({ projectId, callId: opened, startedAt: Date.now(), history })
      await session.start({ signal: aborter.signal })
      // The new call shows in the tree. Only joining can fail a start: a tree read that
      // fails right after must not end a call that's on.
      void refresh().catch((e: unknown) =>
        log(
          `Reading projects after call ${opened} started failed: ${String(e)}`
        )
      )
    } catch (e) {
      // Cancelled because the call already ended: whatever ended it said why.
      if (!aborter.signal.aborted) setError({ projectId, message: String(e) })
      // Joining may have failed before the room connected, so no disconnect closes the call.
      if (opened !== null) {
        await session.end().catch(() => {})
        await finish(opened)
      }
    } finally {
      if (joining.current === aborter) joining.current = null
      // Not a newer start's, after a cancel.
      setStarting((current) => (current === request ? null : current))
    }
  }

  function cancel() {
    joining.current?.abort()
    setStarting(null)
  }

  // Like the starter's useAgentErrors: a failed agent ends the session, and the project's
  // page says why. The first reason stays: the agent leaving as the call ends is a second
  // failure, and says less than what ended it.
  const onAgentFailed = useCallback(
    (reasons: string[]) => {
      if (active) {
        const failed = {
          projectId: active.projectId,
          message: reasons.join(" ") || "Lost the connection. Try again?",
        }
        setError((current) => current ?? failed)
      }
    },
    [active]
  )

  // The agent's job crashed: fail the call now with the agent's reason, rather than wait
  // out the join timeout (issue #14). Ending the session cancels a start in progress.
  useCoreEvent(onAgentCrashed, ({ room, reason }) => {
    // Only the room joined now: a resumed call has a new room, and the last one's job
    // may crash late. The job only runs once the room is joined, so it has a name.
    if (!active || session.room.name !== room) return
    // The reason is for us, not the user: it goes to app.log.
    log(`${room}: the agent's job crashed: ${reason}`)
    setError({
      projectId: active.projectId,
      message: "Bomby couldn't start the call. Try again?",
    })
    joining.current?.abort()
    void session.end()
  })

  return (
    <CallContext value={{ active, starting, error, start, cancel }}>
      <AgentSessionProvider session={session}>
        {children}
        {active && <CallRecorder call={active} />}
        <EndOnAgentFailure onFailed={onAgentFailed} />
        <MicReport />
        <MuteShortcut />
        <PinMicrophone />
        {/* Shows only if the webview blocks audio playback until a click. */}
        <StartAudioButton
          label="Turn on sound"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2"
        />
      </AgentSessionProvider>
    </CallContext>
  )
}

/**
 * Ends the session when the agent fails (it timed out joining, or left), as the starter
 * does, and when the agent says the voice model ended the call (`callFailure`): the agent
 * stays in the room then, so nothing else would end it.
 */
function EndOnAgentFailure({
  onFailed,
}: {
  onFailed: (reasons: string[]) => void
}) {
  const { isConnected, end } = useSessionContext()
  const agent = useAgent()
  const said = callFailure(agent.attributes)
  useEffect(() => {
    if (!isConnected) return
    if (said !== null) {
      onFailed([said])
      void end()
    } else if (agent.state === "failed") {
      onFailed(agent.failureReasons)
      void end()
    }
  }, [agent, said, isConnected, end, onFailed])
  return null
}

/**
 * Saves the call's transcript to the core as it arrives, again whenever a line grows.
 * LiveKit keeps none. Lines from before this call (the session is reused) are skipped.
 */
function CallRecorder({ call }: { call: ActiveCall }) {
  const { messages } = useSessionMessages()
  const saved = useRef(new Map<string, string>())
  useEffect(() => {
    for (const message of messages) {
      const role = roleOf(message)
      const text = message.message.trim()
      if (!role || !text || message.timestamp < call.startedAt) continue
      const id = lineId(message)
      if (saved.current.get(id) === text) continue
      saved.current.set(id, text)
      track(
        call.callId,
        saveMessage(call.callId, { segmentId: id, role, text })
      )
    }
  }, [messages, call])
  return null
}

/**
 * Keeps the call on the mic it started with. LiveKit follows the system's default input,
 * and macOS can move that mid-call: with Bluetooth headphones it switched to their own mic
 * (2026-11-04), which hears their playback, so the agent heard itself. Once the mic is
 * published, its real device becomes the active one, through LiveKit's own
 * `switchActiveDevice`. Choosing a device in the control bar still works.
 */
function PinMicrophone() {
  const { room, local } = useSessionContext()
  const track = local.microphoneTrack?.publication.track?.mediaStreamTrack
  useEffect(() => {
    const deviceId = track?.getSettings().deviceId
    const chosen = room.getActiveDevice("audioinput")
    // Already on a specific device (pinned, or picked in the control bar): leave it.
    if (!deviceId || (chosen && chosen !== "default")) return
    void room.switchActiveDevice("audioinput", deviceId, true).then(
      () => log(`mic pinned: ${JSON.stringify(track?.label)}`),
      (e: unknown) => log(`mic pin failed: ${String(e)}`)
    )
  }, [room, track])
  return null
}

/**
 * Writes which mic the webview opened, and with what processing, to `app.log`: the facts
 * behind any audio problem, which only the page can see.
 */
function MicReport() {
  const { local } = useSessionContext()
  const track = local.microphoneTrack?.publication.track?.mediaStreamTrack
  useEffect(() => {
    if (!track) return
    const settings = track.getSettings()
    log(
      `mic published: label=${JSON.stringify(track.label)} settings=${JSON.stringify(settings)}`
    )
  }, [track])
  return null
}

export function useCall(): CallState {
  const state = use(CallContext)
  if (!state) throw new Error("useCall must be used inside CallProvider")
  return state
}
