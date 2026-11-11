import {
  ArrowLeftRight,
  Bot,
  Check,
  CircleSlash,
  FileText,
  FolderInput,
  Globe,
  Lightbulb,
  LoaderCircle,
  Minus,
  type LucideIcon,
  PencilLine,
  Play,
  Search,
  Terminal,
  Trash2,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react"
import { createElement, useEffect, useState } from "react"

import { Markdown } from "@/components/markdown"
import { Mascot } from "@/components/mascot"
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
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace"
import { AgentLogo } from "@/features/agents/agent-logos"
import { cn } from "@/lib/utils"

import { watchAgentStreams } from "./api"
import {
  activity,
  ENDINGS,
  type Outcome,
  type ToolStatus,
  type AgentStream,
  type Entry,
  reduce,
  type Streams,
  took,
  toolLine,
  working,
} from "./streams"

/** The Agents panel's toggle and header (`ExtraTab`, without its content). */
export const AGENTS_TAB = {
  id: "agents",
  label: "Agents",
  icon: createElement(Bot),
  keywords: ["stream", "activity", "tools", "claude", "codex"],
}

/**
 * The Agents panel: what each coding agent has done on the call, live and read-only. A row
 * per agent and session on one side, the chosen one's messages and tool calls on the other,
 * run after run, following the newest. It's there until the call ends, and kept nowhere
 * after (docs/decisions/agent-streams-through-the-core.md). `callId` is the project's call
 * on now, or null.
 */
export function AgentsView({ callId }: { callId: number | null }) {
  const streams = useAgentStreams(callId)
  const [chosen, setChosen] = useState<string | null>(null)
  // The one chosen, else the first at work, else the first.
  const current =
    streams.find((s) => s.id === chosen) ??
    streams.find(working) ??
    streams.at(0)

  if (!current) return <Empty />
  return (
    <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
      <ResizablePanel
        id="agents-list"
        defaultSize="38%"
        minSize={128}
        className="flex min-w-0 flex-col"
      >
        <AgentList
          streams={streams}
          current={current}
          onChoose={(s) => setChosen(s.id)}
        />
      </ResizablePanel>
      <ResizableHandle className="hover:bg-ring/40 data-[separator=active]:bg-ring/60" />
      <ResizablePanel
        id="agents-stream"
        minSize={160}
        className="flex min-w-0 flex-col"
      >
        <StreamHeader stream={current} />
        <StreamView key={current.id} stream={current} />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

/** No agent has worked on the call yet, or no call is on: as To-dos' empty panel. */
function Empty() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-10 pb-16 text-center">
      <Mascot state="idle" size={40} />
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold">
          No agent&apos;s working right now.
        </p>
        <p className="text-sm text-muted-foreground">
          Ask Bomby for something, and watch it work here.
        </p>
      </div>
    </div>
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
    // A watch that's over says nothing more: an event of the last call still on its way
    // mustn't replace the next call's streams, so it's turned away here and again when
    // the update runs.
    watchAgentStreams(callId, (event) => {
      if (gone) return
      setState((was) =>
        gone
          ? was
          : {
              callId,
              streams: reduce(was.callId === callId ? was.streams : [], event),
            }
      )
    }).then(
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

/**
 * One row per agent and session: its logo on a tile, its name over the session, what it's
 * on now under them, and the working disc of the tasks list while it works.
 */
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
      aria-label="Agents on this call"
      className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1.5"
    >
      {streams.map((stream) => {
        const chosen = stream === current
        const busy = working(stream)
        return (
          <li key={stream.id} className="flex">
            <button
              type="button"
              aria-pressed={chosen}
              onClick={() => onChoose(stream)}
              title={`${stream.name}, ${stream.session}`}
              className={cn(
                "group/agent flex w-full min-w-0 shrink-0 items-start gap-2.5 rounded-lg p-2 text-left outline-none select-none hover:bg-accent/60 focus-visible:bg-accent/60",
                chosen && "bg-accent hover:bg-accent"
              )}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground [&_svg]:size-4",
                  chosen && "bg-background"
                )}
              >
                <AgentLogo id={stream.agent} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">
                    {stream.name}
                  </span>
                  {busy && (
                    <span
                      aria-hidden
                      className="ml-auto flex size-4 shrink-0 items-center justify-center rounded-full bg-highlighter text-highlighter-foreground"
                    >
                      <LoaderCircle className="size-2.5 animate-spin" />
                    </span>
                  )}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {stream.session}
                </span>
                <span
                  className={cn(
                    "mt-1 truncate text-xs text-muted-foreground",
                    busy
                      ? "shimmer text-foreground/80 motion-reduce:shimmer-none"
                      : "opacity-70"
                  )}
                >
                  {activity(stream)}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** Whose stream this is, and how many tool calls it has made, in mono as counts are. */
function StreamHeader({ stream }: { stream: AgentStream }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
      <span className="flex shrink-0 text-foreground [&_svg]:size-4">
        <AgentLogo id={stream.agent} />
      </span>
      <span className="shrink-0 text-sm font-medium">{stream.name}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        {stream.session}
      </span>
      {stream.steps > 0 && (
        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
          {stream.steps} {stream.steps === 1 ? "step" : "steps"}
        </span>
      )}
    </div>
  )
}

/** An agent's messages and tool calls in a session, run after run, following the newest. */
function StreamView({ stream }: { stream: AgentStream }) {
  const groups = group(stream.entries)
  const last = stream.entries.at(-1)
  // Between a run's steps nothing moves, so one line says it's still at it.
  const between =
    working(stream) &&
    (last?.kind === "started" ||
      last?.kind === "dropped" ||
      (last?.kind === "tool" && last.status !== "running"))
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller
        aria-label={`${stream.name}, ${stream.session}`}
        className="min-h-0 flex-1"
      >
        <MessageScrollerViewport>
          <MessageScrollerContent className="gap-3.5 px-3 py-3 select-text">
            {groups.map((g) => (
              <MessageScrollerItem key={g[0].key} messageId={g[0].key}>
                <EntryGroup entries={g} />
              </MessageScrollerItem>
            ))}
            {between && (
              <MessageScrollerItem messageId={`${stream.id}:working`}>
                <Trace>
                  <TraceLine status="running">
                    <TraceIcon>
                      <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                    </TraceIcon>
                    <TraceTitle>{activity(stream)}</TraceTitle>
                  </TraceLine>
                </Trace>
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton variant="outline" className="rounded-full" />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

/** An icon for each of ACP's tool kinds; a wrench for one it doesn't name. */
const KIND_ICONS: Record<string, LucideIcon> = {
  read: FileText,
  edit: PencilLine,
  delete: Trash2,
  move: FolderInput,
  search: Search,
  execute: Terminal,
  think: Lightbulb,
  fetch: Globe,
  switch_mode: ArrowLeftRight,
}

/** The icon on the mark where a run ended, by how it ended: the tasks list's own. */
const ENDING_ICONS: Record<Outcome, LucideIcon> = {
  done: Check,
  stopped: CircleSlash,
  failed: X,
  ended: Minus,
}

/**
 * A tool call's status as its Trace line's: none once done, and Trace's quiet "pending"
 * for one its run ended on, which neither ran to its end nor failed.
 */
const LINE_STATUS: Record<
  ToolStatus,
  "running" | "error" | "pending" | undefined
> = { running: "running", error: "error", done: undefined, ended: "pending" }

/** A message, a mark where a run starts or ends, or tool calls in a row as one Trace. */
function EntryGroup({ entries }: { entries: Entry[] }) {
  const first = entries[0]
  switch (first.kind) {
    case "message":
      return (
        <Message>
          <MessageContent>
            <Markdown className="text-sm leading-relaxed text-foreground">
              {first.text}
            </Markdown>
          </MessageContent>
        </Message>
      )
    case "started":
      return (
        <Marker variant="separator" className="text-xs">
          <MarkerIcon>
            <Play className="size-3!" />
          </MarkerIcon>
          <MarkerContent>
            Started{first.at > 0 && ` ${clock(first.at)}`}
          </MarkerContent>
        </Marker>
      )
    case "finished": {
      const Icon = ENDING_ICONS[first.outcome]
      // "Finished in 48s", and "Stopped after 48s" for a run that didn't get there.
      const span = first.outcome === "done" ? "in" : "after"
      return (
        <Marker variant="separator" className="text-xs">
          <MarkerIcon>
            <Icon className="size-3!" />
          </MarkerIcon>
          <MarkerContent>
            {ENDINGS[first.outcome]}
            {first.took > 0 && ` ${span} ${took(first.took)}`}
          </MarkerContent>
        </Marker>
      )
    }
    case "dropped":
      return (
        <Marker>
          <MarkerIcon>
            <TriangleAlert />
          </MarkerIcon>
          <MarkerContent>
            Some of what it did didn't make it here.
          </MarkerContent>
        </Marker>
      )
    case "tool":
      return (
        <Trace>
          {entries.map((tool) => {
            if (tool.kind !== "tool") return null
            const { words, command } = toolLine(tool)
            const Icon = KIND_ICONS[tool.toolKind ?? ""] ?? Wrench
            return (
              <TraceLine key={tool.key} status={LINE_STATUS[tool.status]}>
                <TraceIcon>
                  <Icon />
                </TraceIcon>
                <TraceTitle>
                  {words}
                  {command !== null && (
                    <>
                      {" "}
                      <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs text-foreground/80 in-data-[status=error]:text-destructive">
                        {command}
                      </code>
                    </>
                  )}
                </TraceTitle>
              </TraceLine>
            )
          })}
        </Trace>
      )
  }
}

/** The time of day, as the user's Mac writes it: "2:14 PM". */
function clock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })
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
