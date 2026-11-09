import type { AgentState, ReceivedMessage } from "@livekit/components-react"
import { ChevronRight } from "lucide-react"
import { type ComponentProps, Fragment, useState } from "react"
import { Streamdown } from "streamdown"

import { AgentChatIndicator } from "@/components/agents-ui/agent-chat-indicator"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { Message, MessageContent } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller"
import { cn } from "@/lib/utils"

import { type SessionLines, sessionLabel } from "./transcript"

/**
 * A call's conversation with a divider over each of its sessions (each opening or resume),
 * which folds that session's lines away. It's Agents UI's `AgentChatTranscript`, from the
 * same parts and with the same bubbles, plus the dividers, which that one has no room for;
 * `.call-transcript` styles both.
 *
 * `sessions` are the saved ones; `live` are the lines of the session on now, which come
 * last with no divider. Without `live`, a call with one session shows no divider at all.
 */
export function SessionTranscript({
  sessions,
  live,
  folded = false,
  agentState,
  defaultScrollPosition = "last-anchor",
  className,
}: {
  sessions: SessionLines[]
  live?: ReceivedMessage[]
  /** Whether the saved sessions start folded. */
  folded?: boolean
  /** When "thinking", shows the indicator under the last line. */
  agentState?: AgentState
  defaultScrollPosition?: ComponentProps<
    typeof MessageScrollerProvider
  >["defaultScrollPosition"]
  className?: string
}) {
  const [open, setOpen] = useState(
    () => new Set(folded ? [] : sessions.map((s) => s.session.id))
  )
  const dividers = live !== undefined || sessions.length > 1

  function toggle(id: number) {
    setOpen((was) => {
      const now = new Set(was)
      if (!now.delete(id)) now.add(id)
      return now
    })
  }

  return (
    <MessageScrollerProvider
      autoScroll
      defaultScrollPosition={defaultScrollPosition}
    >
      <MessageScroller className={className}>
        <MessageScrollerViewport>
          <MessageScrollerContent aria-busy={agentState === "thinking"}>
            {sessions.map(({ session, lines }, index) => {
              const shown = !dividers || open.has(session.id)
              return (
                <Fragment key={session.id}>
                  {dividers && (
                    <MessageScrollerItem messageId={dividerId(session.id)}>
                      <SessionDivider
                        messageId={dividerId(session.id)}
                        label={sessionLabel(session, index === 0)}
                        lines={lines.length}
                        open={shown}
                        onToggle={() => toggle(session.id)}
                      />
                    </MessageScrollerItem>
                  )}
                  {shown && lines.map(line)}
                </Fragment>
              )
            })}
            {live?.map(line)}
            {agentState === "thinking" && (
              <MessageScrollerItem>
                <Marker asChild>
                  <output>
                    <MarkerIcon>
                      <AgentChatIndicator size="sm" />
                    </MarkerIcon>
                    <MarkerContent className="shimmer">
                      Thinking...
                    </MarkerContent>
                  </output>
                </Marker>
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton variant="outline" className="rounded-full" />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

/** A divider's id in the scroller, apart from the lines' (LiveKit's ids and row ids). */
function dividerId(sessionId: number): string {
  return `session:${sessionId}`
}

/**
 * "Resumed Yesterday, 09:05 · 4 min" across the transcript; folds its session away. It
 * brings itself to the top first, so the lines it unfolds show under it: the scroller
 * would otherwise keep following the bottom past them.
 */
function SessionDivider({
  messageId,
  label,
  lines,
  open,
  onToggle,
}: {
  messageId: string
  label: string
  lines: number
  open: boolean
  onToggle: () => void
}) {
  const { scrollToMessage } = useMessageScroller()

  function toggle() {
    scrollToMessage(messageId, { align: "start", behavior: "auto" })
    onToggle()
  }

  return (
    <Marker variant="separator" asChild>
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="group/divider rounded-sm py-1 text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MarkerContent className="flex items-center gap-1">
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3.5! transition-transform",
              open && "rotate-90"
            )}
          />
          {label}
          {!open && (
            <span className="text-muted-foreground/70">
              {" · "}
              {lines === 1 ? "1 line" : `${lines} lines`}
            </span>
          )}
        </MarkerContent>
      </button>
    </Marker>
  )
}

/** One line, as `AgentChatTranscript` draws it: the user's on the right. */
function line({ id, timestamp, from, message }: ReceivedMessage) {
  const isUser = from?.isLocal
  return (
    <MessageScrollerItem key={id} messageId={id}>
      <Message
        align={isUser ? "end" : "start"}
        title={new Date(timestamp).toLocaleTimeString(undefined, {
          timeStyle: "full",
        })}
      >
        <MessageContent>
          <Bubble
            align={isUser ? "end" : "start"}
            variant={isUser ? "secondary" : "ghost"}
          >
            <BubbleContent>
              <Streamdown>{message}</Streamdown>
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  )
}
