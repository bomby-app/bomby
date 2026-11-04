import { useAgent, useSessionContext } from "@livekit/components-react"
import { Check, CircleSlash, Inbox, LoaderCircle, Plus, X } from "lucide-react"
import { useMemo } from "react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AgentLogo } from "@/features/agents/agent-logos"
import { cn } from "@/lib/utils"

/** What the voice agent publishes as `bomby.tasks` (agent/task_board.py). */
type Task = {
  id: string
  agent: string
  agentName: string
  session: string
  task: string
  status: "working" | "added" | "done" | "failed" | "stopped"
  startedAt: number
  endedAt: number | null
}

const ATTRIBUTE = "bomby.tasks"

/** The call's tasks, newest first, from the agent participant's attributes. */
function useTasks(): Task[] {
  const session = useSessionContext()
  const { attributes } = useAgent(session)
  const raw = attributes[ATTRIBUTE]
  return useMemo(() => {
    if (!raw) return []
    try {
      return (JSON.parse(raw) as Task[]).slice().reverse()
    } catch {
      return []
    }
  }, [raw])
}

/**
 * The agents panel in the call's header: a box icon with the number of running tasks,
 * opening the list of what each agent is doing on this call.
 */
export function AgentsPanel() {
  const tasks = useTasks()
  const working = tasks.filter((t) => t.status === "working").length

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={working ? `Tasks, ${working} running` : "Tasks"}
          className="relative"
        >
          <Inbox />
          {working > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground tabular-nums">
              {working}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <PopoverHeader className="px-3 pt-3">
          <PopoverTitle>Tasks</PopoverTitle>
        </PopoverHeader>
        {tasks.length === 0 ? (
          <p className="px-3 pb-3 text-sm text-muted-foreground">
            Nothing yet. Ask for something and it shows up here.
          </p>
        ) : (
          <ScrollArea className="**:data-[slot=scroll-area-viewport]:max-h-80">
            <ul className="flex flex-col divide-y px-1 pb-1">
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  )
}

function TaskRow({ task }: { task: Task }) {
  return (
    <li className="flex gap-2.5 px-2 py-2.5">
      <span className="flex size-5 shrink-0 items-center justify-center pt-0.5 text-foreground [&_svg]:size-4">
        <AgentLogo id={task.agent} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{task.session}</span>
          <TaskStatus status={task.status} />
        </div>
        <span className="line-clamp-2 text-xs text-muted-foreground select-text">
          {task.agentName}: {task.task}
        </span>
      </div>
    </li>
  )
}

const STATUS = {
  working: { label: "Working", Icon: LoaderCircle },
  added: { label: "Added", Icon: Plus },
  done: { label: "Done", Icon: Check },
  failed: { label: "Failed", Icon: X },
  stopped: { label: "Stopped", Icon: CircleSlash },
} as const

function TaskStatus({ status }: { status: Task["status"] }) {
  const { label, Icon } = STATUS[status] ?? STATUS.done
  return (
    <span
      className={cn(
        "ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground",
        status === "failed" && "text-destructive"
      )}
    >
      {status === "done" ? (
        // Good news is an ink mark on a highlighter disc (docs/brand.md).
        <span className="flex size-3.5 items-center justify-center rounded-full bg-highlighter text-highlighter-foreground">
          <Icon className="size-2.5" strokeWidth={3} />
        </span>
      ) : (
        <Icon
          className={cn(
            "size-3.5",
            // Highlighter in dark mode, ink in light (never highlighter on white).
            status === "working" && "animate-spin text-primary"
          )}
        />
      )}
      {label}
    </span>
  )
}
