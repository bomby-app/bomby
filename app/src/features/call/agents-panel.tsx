import {
  Check,
  CircleSlash,
  Inbox,
  ListEnd,
  LoaderCircle,
  Plus,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { AgentLogo } from "@/features/agents/agent-logos"
import { cn } from "@/lib/utils"

import { type Task, useTasks } from "./tasks"

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

const HIGHLIGHTER = "bg-highlighter text-highlighter-foreground"

/**
 * Each status is one ink icon on a disc, its label a tooltip and what screen readers hear:
 * bubblegum while a task waits or joins another (queued, added), highlighter otherwise
 * (owner, 2026-11-05; docs/brand.md).
 */
const STATUS = {
  queued: {
    label: "Queued",
    Icon: ListEnd,
    disc: "bg-claude text-claude-foreground",
  },
  working: { label: "Working", Icon: LoaderCircle, disc: HIGHLIGHTER },
  added: {
    label: "Added to the running task",
    Icon: Plus,
    disc: "bg-claude text-claude-foreground",
  },
  done: { label: "Done", Icon: Check, disc: HIGHLIGHTER },
  failed: { label: "Failed", Icon: X, disc: HIGHLIGHTER },
  stopped: { label: "Stopped", Icon: CircleSlash, disc: HIGHLIGHTER },
} as const

function TaskStatus({ status }: { status: Task["status"] }) {
  const { label, Icon, disc } = STATUS[status] ?? STATUS.done
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "ml-auto flex size-4 shrink-0 items-center justify-center rounded-full",
            disc
          )}
        >
          <Icon
            className={cn("size-2.5", status === "working" && "animate-spin")}
            strokeWidth={3}
          />
          <span className="sr-only">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
