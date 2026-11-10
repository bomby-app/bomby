import { Activity, TriangleAlert } from "lucide-react"
import { createElement, useEffect, useState } from "react"
import { Streamdown } from "streamdown"

import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { Message, MessageContent } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { Trace, TraceLine, TraceTitle } from "@/components/ui/trace"
import { AgentLogo } from "@/features/agents/agent-logos"
import { cn } from "@/lib/utils"

import { watchAgentStreams } from "./api"
import {
  type AgentStream,
  type Entry,
  reduce,
  running,
  type Streams,
  toolTitle,
} from "./streams"

/** The Agents panel's toggle and header (`ExtraTab`, without its content). */
export const AGENTS_TAB = {
  id: "agents",
  label: "Agents",
  icon: createElement(Activity),
  keywords: ["stream", "activity", "tools", "claude", "codex"],
}

/**
 * The Agents panel: what each coding agent is doing on the call, live and read-only. The
 * agents with a turn running, one row per agent and session, beside the chosen one's
 * messages and tool calls as they come. A turn that ends leaves the list, and nothing of
 * it is kept (docs/decisions/agent-streams-through-the-core.md). `callId` is the project's
 * call on now, or null.
 */
export function AgentsView({ callId }: { callId: number | null }) {
  const streams = running(useAgentStreams(callId))
  const [chosen, setChosen] = useState<string | null>(null)
  // The one chosen while it runs, else the first.
  const current = streams.find((s) => s.id === chosen) ?? streams.at(0)

  if (!current) {
    return (
      <p className="m-auto max-w-64 px-6 text-center text-sm text-muted-foreground">
        No agent's working right now. Ask Bomby for something, and watch it work
        here.
      </p>
    )
  }
  return (
    <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
      <ResizablePanel
        id="agents-list"
        defaultSize="34%"
        minSize={112}
        className="flex min-w-0 flex-col"
      >
        <AgentList
          streams={streams}
          current={current}
          onChoose={(s) => setChosen(s.id)}
        />
      </ResizablePanel>
      <ResizableHandle className="hover:bg-ring/40 data-[separator=active]:bg-ring/60" />
      <ResizablePanel id="agents-stream" minSize={160} className="min-w-0">
        <StreamView key={current.id} stream={current} />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

/** The call's streams as the core sends them, from the start of `callId`'s watch. */
function useAgentStreams(callId: number | null): Streams {
  const [state, setState] = useState<{ callId: number; streams: Streams }>({
    callId: -1,
    streams: [],
  })
  useEffect(() => {
    if (callId === null) return
    let stop: (() => void) | null = null
    let gone = false
    watchAgentStreams(callId, (event) =>
      setState((was) => ({
        callId,
        streams: reduce(was.callId === callId ? was.streams : [], event),
      }))
    ).then(
      (unwatch) => {
        if (gone) unwatch()
        else stop = unwatch
      },
      () => {}
    )
    return () => {
      gone = true
      stop?.()
      // What's held belongs to this watch; the next one starts from the core's.
      setState({ callId: -1, streams: [] })
    }
  }, [callId])
  return state.callId === callId ? state.streams : []
}

/** One row per running turn: the agent's logo, its name and the session. */
function AgentList({
  streams,
  current,
  onChoose,
}: {
  streams: AgentStream[]
  current: AgentStream
  onChoose: (stream: AgentStream) => void
}) {
  return (
    <ul
      aria-label="Agents working"
      className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5"
    >
      {streams.map((stream) => {
        const chosen = stream === current
        return (
          <li key={stream.id} className="flex">
            <button
              type="button"
              aria-pressed={chosen}
              onClick={() => onChoose(stream)}
              title={`${stream.name} · ${stream.session}`}
              className={cn(
                "flex h-8 w-full min-w-0 shrink-0 items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground outline-none select-none hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground",
                chosen && "bg-accent text-foreground"
              )}
            >
              <AgentLogo id={stream.agent} className="size-4 shrink-0" />
              <span className="min-w-0 truncate">
                <span className="font-medium">{stream.name}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {stream.session}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** One turn's messages and tool calls, following the newest. */
function StreamView({ stream }: { stream: AgentStream }) {
  const groups = group(stream.entries)
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller aria-label={`${stream.name} · ${stream.session}`}>
        <MessageScrollerViewport>
          <MessageScrollerContent className="gap-4 px-3 py-3 select-text">
            {groups.length === 0 && (
              <MessageScrollerItem messageId={`${stream.id}:waiting`}>
                <Trace>
                  <TraceLine status="running">
                    <TraceTitle>{stream.name}'s getting started</TraceTitle>
                  </TraceLine>
                </Trace>
              </MessageScrollerItem>
            )}
            {groups.map((g) => (
              <MessageScrollerItem key={g[0].key} messageId={g[0].key}>
                <EntryGroup entries={g} />
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton variant="outline" className="rounded-full" />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

/** A message, a missing-events marker, or tool calls in a row, as one Trace. */
function EntryGroup({ entries }: { entries: Entry[] }) {
  const first = entries[0]
  if (first.kind === "message") {
    return (
      <Message>
        <MessageContent>
          <Streamdown className="text-sm">{first.text}</Streamdown>
        </MessageContent>
      </Message>
    )
  }
  if (first.kind === "dropped") {
    return (
      <Marker>
        <MarkerIcon>
          <TriangleAlert />
        </MarkerIcon>
        <MarkerContent>Some of what it did didn't make it here.</MarkerContent>
      </Marker>
    )
  }
  return (
    <Trace>
      {entries.map(
        (tool) =>
          tool.kind === "tool" && (
            <TraceLine
              key={tool.key}
              status={tool.status === "done" ? undefined : tool.status}
            >
              <TraceTitle>{toolTitle(tool)}</TraceTitle>
            </TraceLine>
          )
      )}
    </Trace>
  )
}

/** The entries with each run of tool calls in one group. */
function group(entries: Entry[]): Entry[][] {
  const groups: Entry[][] = []
  for (const entry of entries) {
    const last = groups.at(-1)
    if (entry.kind === "tool" && last?.[0].kind === "tool") last.push(entry)
    else groups.push([entry])
  }
  return groups
}
