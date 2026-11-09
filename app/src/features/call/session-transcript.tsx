import type { AgentState, ReceivedMessage } from "@livekit/components-react"
import { ChevronRight, Clock, Phone, Play } from "lucide-react"
import {
  type ComponentProps,
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
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

import {
  type SessionLabel,
  type SessionLines,
  sessionLabel,
} from "./transcript"

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
 * A pill over each session, centred between its lines and the ones before: Started or
 * Resumed, when, and how long, with its line count while folded. Solid bubblegum, the
 * colour of resuming (the Resume button's), so it reads on both the highlighter and the
 * ink bubbles around it (owner, 2026-11-09). Clicking it folds its session away. Once
 * unfolded lines are in, it brings itself to the top, so what it unfolds shows under it:
 * the scroller would otherwise follow the bottom past them. That runs after the change is
 * in the page and before it's painted, so the scroller measures the transcript as it now
 * is (its spacer included), and the scroller's own reaction to the new lines, which comes
 * after, finds it no longer following the bottom.
 */
function SessionDivider({
  messageId,
  label,
  lines,
  open,
  onToggle,
}: {
  messageId: string
  label: SessionLabel
  lines: number
  open: boolean
  onToggle: () => void
}) {
  const { scrollToMessage } = useMessageScroller()
  // Only the user's own unfolding moves the transcript, never a render for another reason.
  // Folding leaves it be: bringing a pill with nothing under it to the top would have the
  // scroller pad the bottom with blank space to get it there.
  const toggled = useRef(false)
  useLayoutEffect(() => {
    if (!toggled.current) return
    toggled.current = false
    if (open) scrollToMessage(messageId, { align: "start", behavior: "auto" })
  }, [open, messageId, scrollToMessage])

  function toggle() {
    toggled.current = true
    onToggle()
  }

  const KindIcon = label.kind === "Started" ? Phone : Play
  return (
    <div className="flex justify-center py-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="inline-flex max-w-full items-center gap-2 rounded-full bg-claude py-1.5 pr-3.5 pl-2.5 text-xs font-medium text-claude-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5 [&_svg]:shrink-0"
      >
        <ChevronRight
          aria-hidden
          className={cn("transition-transform", open && "rotate-90")}
        />
        <span className="inline-flex items-center gap-1">
          <KindIcon aria-hidden />
          {label.kind}
        </span>
        <span className="inline-flex min-w-0 items-center gap-1">
          <Clock aria-hidden />
          <span className="truncate">
            {label.when}
            {label.length && ` · ${label.length}`}
            {!open && ` · ${lines === 1 ? "1 line" : `${lines} lines`}`}
          </span>
        </span>
      </button>
    </div>
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
