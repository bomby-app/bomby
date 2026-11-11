import type { StreamEvent } from "@/generated/agent-streams"

/**
 * A tool call as one line: running, failed, done, or ended, when its run was stopped or
 * broke before the agent said how the call went.
 */
export type ToolStatus = "running" | "error" | "done" | "ended"

/**
 * How a run ended: the agent finished it, it was stopped (or stopped early), it broke, or,
 * when the worker went before it could say, it just ended.
 */
export type Outcome = "done" | "stopped" | "failed" | "ended"

export type Entry =
  | {
      /** A run begins: a task the agent takes in this session. */
      kind: "started"
      key: string
      /** When the core got it, in ms since 1970. */
      at: number
    }
  | {
      kind: "message"
      key: string
      /** The agent's id for the message, when it gives one. */
      id: string | null
      text: string
    }
  | {
      kind: "tool"
      key: string
      id: string
      title: string | null
      /** ACP's kind: read, edit, execute and so on. */
      toolKind: string | null
      status: ToolStatus
    }
  | { kind: "dropped"; key: string }
  | {
      /** The run is over. */
      kind: "finished"
      key: string
      at: number
      /** How long it ran, in ms. */
      took: number
      outcome: Outcome
    }

/**
 * One agent in one session of the call: what it said and did, run after run, in order.
 * A session's runs come one at a time, so they read as one stream.
 */
export type AgentStream = {
  /** The agent and the session, which name the row. */
  id: string
  /** The harness id, for its logo. */
  agent: string
  /** "Claude" */
  name: string
  session: string
  entries: Entry[]
  /** The core's id for the run going on now; null between runs. */
  run: string | null
  /** How many tool calls it has made on the call. */
  steps: number
}

/** The call's streams, in the order each agent and session first started. */
export type Streams = AgentStream[]

/**
 * `streams` after `event` (agent_streams.rs). A run that starts in an agent and session
 * already listed continues its row. Text appends to the message it continues; a tool call's
 * events are patches by id, within its run, and one for an id not seen yet starts a line;
 * `dropped` leaves one marker where events are missing; `end` ends the run, which stays, and
 * its tool calls still open: done when the agent finished the run, only ended otherwise,
 * since a stopped command didn't run to its end. Events of a run that isn't going on are
 * ignored.
 */
export function reduce(streams: Streams, event: StreamEvent): Streams {
  if (event.type === "start") {
    if (streams.some((s) => s.run === event.stream)) return streams
    const id = `${event.agent}/${event.session}`
    const row = streams.find((s) => s.id === id)
    const started = (index: number): Entry => ({
      kind: "started",
      key: `${id}:${index}`,
      at: event.at,
    })
    if (!row) {
      return [
        ...streams,
        {
          id,
          agent: event.agent,
          name: event.name,
          session: event.session,
          entries: [started(0)],
          run: event.stream,
          steps: 0,
        },
      ]
    }
    const next = {
      ...row,
      name: event.name,
      entries: [...row.entries, started(row.entries.length)],
      run: event.stream,
    }
    return streams.map((s) => (s === row ? next : s))
  }
  const stream = streams.find((s) => s.run === event.stream)
  if (!stream) return streams
  const next = apply(stream, event)
  return next === stream
    ? streams
    : streams.map((s) => (s === stream ? next : s))
}

function apply(
  stream: AgentStream,
  event: Exclude<StreamEvent, { type: "start" }>
): AgentStream {
  const entries = stream.entries
  const key = `${stream.id}:${entries.length}`
  // Where the run going on began: a tool call's id is its run's.
  const from = entries.map((e) => e.kind).lastIndexOf("started")
  switch (event.type) {
    case "text": {
      if (!event.text) return stream
      const last = entries.at(-1)
      // It continues the last message unless their ids say otherwise.
      if (
        last?.kind === "message" &&
        (last.id === null ||
          event.message === null ||
          last.id === event.message)
      ) {
        const joined = {
          ...last,
          id: last.id ?? event.message,
          text: last.text + event.text,
        }
        return { ...stream, entries: [...entries.slice(0, -1), joined] }
      }
      return {
        ...stream,
        entries: [
          ...entries,
          { kind: "message", key, id: event.message, text: event.text },
        ],
      }
    }
    case "tool": {
      const at = entries.findIndex(
        (e, i) => i > from && e.kind === "tool" && e.id === event.id
      )
      if (at === -1) {
        return {
          ...stream,
          steps: stream.steps + 1,
          entries: [
            ...entries,
            {
              kind: "tool",
              key,
              id: event.id,
              title: event.title ?? null,
              toolKind: event.kind ?? null,
              status: toolStatus(event.status),
            },
          ],
        }
      }
      const tool = entries[at]
      if (tool.kind !== "tool") return stream
      const patched = {
        ...tool,
        title: event.title ?? tool.title,
        toolKind: event.kind ?? tool.toolKind,
        status:
          event.status === undefined ? tool.status : toolStatus(event.status),
      }
      return {
        ...stream,
        entries: entries.map((e, i) => (i === at ? patched : e)),
      }
    }
    case "dropped":
      if (entries.at(-1)?.kind === "dropped") return stream
      return { ...stream, entries: [...entries, { kind: "dropped", key }] }
    case "end": {
      const began = entries[from]
      const outcome = outcomeOf(event.outcome)
      const closed = entries.map((e): Entry =>
        e.kind === "tool" && e.status === "running"
          ? { ...e, status: outcome === "done" ? "done" : "ended" }
          : e
      )
      return {
        ...stream,
        run: null,
        entries: [
          ...closed,
          {
            kind: "finished",
            key,
            at: event.at,
            took:
              began?.kind === "started" ? Math.max(0, event.at - began.at) : 0,
            outcome,
          },
        ],
      }
    }
  }
}

/** ACP's status as a line's: an unknown one reads as still running. */
function toolStatus(status: string | undefined): ToolStatus {
  if (status === "completed") return "done"
  if (status === "failed") return "error"
  return "running"
}

/** The worker's word for how a run ended; one it doesn't give, or a new one, reads ended. */
function outcomeOf(outcome: string | undefined): Outcome {
  return outcome === "done" || outcome === "stopped" || outcome === "failed"
    ? outcome
    : "ended"
}

/** A run's end in a word, for its mark and its row. */
export const ENDINGS: Record<Outcome, string> = {
  done: "Finished",
  stopped: "Stopped",
  failed: "Failed",
  ended: "Ended",
}

/** Whether the agent is working in this session now. */
export function working(stream: AgentStream): boolean {
  return stream.run !== null
}

/**
 * What the agent is on, for its row in the list: its running tool call, else that it's
 * writing; between runs, how the last one ended.
 */
export function activity(stream: AgentStream): string {
  const last = stream.entries.at(-1)
  if (!working(stream))
    return ENDINGS[last?.kind === "finished" ? last.outcome : "ended"]
  if (last?.kind === "tool" && last.status === "running") return toolTitle(last)
  if (last?.kind === "message") return "Writing"
  if (last?.kind === "started") return "Getting started"
  return "Working"
}

/** Running, done, failed and ended, in that order. */
type Words = [string, string, string, string]

/** A tool call without a title, by its kind. */
const UNTITLED: Record<string, Words> = {
  read: [
    "Reading a file",
    "Read a file",
    "Failed to read a file",
    "Didn't finish reading a file",
  ],
  edit: [
    "Editing a file",
    "Edited a file",
    "Failed to edit a file",
    "Didn't finish editing a file",
  ],
  delete: [
    "Deleting a file",
    "Deleted a file",
    "Failed to delete a file",
    "Didn't finish deleting a file",
  ],
  move: [
    "Moving a file",
    "Moved a file",
    "Failed to move a file",
    "Didn't finish moving a file",
  ],
  search: [
    "Searching",
    "Searched",
    "Failed to search",
    "Didn't finish searching",
  ],
  execute: [
    "Running a command",
    "Ran a command",
    "Failed to run a command",
    "Didn't finish running a command",
  ],
  think: [
    "Thinking",
    "Thought it over",
    "Failed to think it over",
    "Didn't finish thinking it over",
  ],
  fetch: [
    "Fetching a page",
    "Fetched a page",
    "Failed to fetch a page",
    "Didn't finish fetching a page",
  ],
  switch_mode: [
    "Switching modes",
    "Switched modes",
    "Failed to switch modes",
    "Didn't finish switching modes",
  ],
}
const ANY_TOOL: Words = [
  "Using a tool",
  "Used a tool",
  "A tool failed",
  "Didn't finish using a tool",
]
const COMMAND: Words = [
  "Running",
  "Ran",
  "Failed to run",
  "Didn't finish running",
]
/** What goes before a title the agent wrote, by status. */
const BEFORE_TITLE: Words = ["", "", "Failed: ", "Didn't finish: "]

type Titled = {
  title: string | null
  toolKind: string | null
  status: ToolStatus
}

/**
 * A tool call's line in two parts, with its status in the words (Trace's Tool pattern):
 * `words`, and `command` when the agent titled a command with the command line itself, to
 * set as code after them ("Ran" and "pnpm test"). Another title reads as the agent wrote it
 * ("Read login.ts"), or "Failed: …", or "Didn't finish: …" for one its run ended on; no
 * title, a phrase for its kind.
 */
export function toolLine(tool: Titled): {
  words: string
  command: string | null
} {
  const which = { running: 0, done: 1, error: 2, ended: 3 }[tool.status]
  const title = tool.title?.trim()
  if (!title)
    return {
      words: (UNTITLED[tool.toolKind ?? ""] ?? ANY_TOOL)[which],
      command: null,
    }
  if (tool.toolKind === "execute" && isCommand(title))
    return { words: COMMAND[which], command: title }
  return { words: BEFORE_TITLE[which] + title, command: null }
}

/** A tool call's line as one string: "Running pnpm test", "Ran pnpm test". */
export function toolTitle(tool: Titled): string {
  const { words, command } = toolLine(tool)
  return command === null ? words : `${words} ${command}`
}

/** A command line, not a sentence: it doesn't start with a capital ("pnpm test", "./x"). */
function isCommand(title: string): boolean {
  const first = title[0]
  return first.toLowerCase() === first
}

/** How long a run took, in a few characters: "8s", "2m 05s", "1h 04m". */
export function took(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const pad = (n: number) => String(n).padStart(2, "0")
  if (minutes < 60) return `${minutes}m ${pad(seconds % 60)}s`
  return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`
}
