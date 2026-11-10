import type { StreamEvent } from "@/generated/agent-streams"

/** A tool call as one line: running, failed, or done (no status). */
export type ToolStatus = "running" | "error" | "done"

export type Entry =
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

/** One agent's running turn in one session: what it said and did, in order. */
export type AgentStream = {
  id: string
  /** The harness id, for its logo. */
  agent: string
  /** "Claude" */
  name: string
  session: string
  entries: Entry[]
  /** The turn is over: it leaves the list. */
  ended: boolean
}

/** The call's streams, in the order their turns started. */
export type Streams = AgentStream[]

/**
 * `streams` after `event` (agent_streams.rs). Text appends to the message it continues;
 * a tool call's events are patches by id, and one for an id not seen yet starts a line;
 * `dropped` leaves one marker where events are missing; `end` closes every tool call still
 * open and ends the stream. Events of a stream that never started are ignored.
 */
export function reduce(streams: Streams, event: StreamEvent): Streams {
  if (event.type === "start") {
    if (streams.some((s) => s.id === event.stream)) return streams
    return [
      // Streams that ended are let go here, once nothing can show them.
      ...streams.filter((s) => !s.ended),
      {
        id: event.stream,
        agent: event.agent,
        name: event.name,
        session: event.session,
        entries: [],
        ended: false,
      },
    ]
  }
  const stream = streams.find((s) => s.id === event.stream)
  if (!stream || stream.ended) return streams
  const next = apply(stream, event)
  return next === stream
    ? streams
    : streams.map((s) => (s === stream ? next : s))
}

function apply(stream: AgentStream, event: StreamEvent): AgentStream {
  const entries = stream.entries
  const key = `${stream.id}:${entries.length}`
  switch (event.type) {
    case "start":
      return stream
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
        (e) => e.kind === "tool" && e.id === event.id
      )
      if (at === -1) {
        return {
          ...stream,
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
    case "end":
      return {
        ...stream,
        ended: true,
        entries: entries.map((e) =>
          e.kind === "tool" && e.status === "running"
            ? { ...e, status: "done" }
            : e
        ),
      }
  }
}

/** ACP's status as a line's: an unknown one reads as still running. */
function toolStatus(status: string | undefined): ToolStatus {
  if (status === "completed") return "done"
  if (status === "failed") return "error"
  return "running"
}

/** The streams to list: the turns still running. */
export function running(streams: Streams): AgentStream[] {
  return streams.filter((s) => !s.ended)
}

/** Running, done and failed, for a tool call without a title, by its kind. */
const UNTITLED: Record<string, [string, string, string]> = {
  read: ["Reading a file", "Read a file", "Failed to read a file"],
  edit: ["Editing a file", "Edited a file", "Failed to edit a file"],
  delete: ["Deleting a file", "Deleted a file", "Failed to delete a file"],
  move: ["Moving a file", "Moved a file", "Failed to move a file"],
  search: ["Searching", "Searched", "Failed to search"],
  execute: ["Running a command", "Ran a command", "Failed to run a command"],
  think: ["Thinking", "Thought it over", "Failed to think it over"],
  fetch: ["Fetching a page", "Fetched a page", "Failed to fetch a page"],
  switch_mode: ["Switching modes", "Switched modes", "Failed to switch modes"],
}
const ANY_TOOL: [string, string, string] = [
  "Using a tool",
  "Used a tool",
  "A tool failed",
]

/**
 * A tool call's line, with its status in the words (Trace's Tool pattern): a command, which
 * agents title with the command line itself, reads "Running pnpm test", "Ran pnpm test" or
 * "Failed to run pnpm test"; another title as the agent wrote it ("Read login.ts"), or
 * "Failed: …"; no title, a phrase for its kind.
 */
export function toolTitle(tool: {
  title: string | null
  toolKind: string | null
  status: ToolStatus
}): string {
  const which = { running: 0, done: 1, error: 2 }[tool.status]
  const title = tool.title?.trim()
  if (!title) return (UNTITLED[tool.toolKind ?? ""] ?? ANY_TOOL)[which]
  if (tool.toolKind === "execute" && isCommand(title))
    return [`Running ${title}`, `Ran ${title}`, `Failed to run ${title}`][which]
  return tool.status === "error" ? `Failed: ${title}` : title
}

/** A command line, not a sentence: it doesn't start with a capital ("pnpm test", "./x"). */
function isCommand(title: string): boolean {
  const first = title[0]
  return first.toLowerCase() === first
}
