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

/**
 * Each status is one icon, its label a tooltip and what screen readers hear. Good news (done,
 * added to a running task) is an ink mark on a highlighter disc (docs/brand.md).
 */
const STATUS = {
  queued: { label: "Queued", Icon: ListEnd, disc: false },
  working: { label: "Working", Icon: LoaderCircle, disc: false },
  added: { label: "Added to the running task", Icon: Plus, disc: true },
  done: { label: "Done", Icon: Check, disc: true },
  failed: { label: "Failed", Icon: X, disc: false },
  stopped: { label: "Stopped", Icon: CircleSlash, disc: false },
} as const

function TaskStatus({ status }: { status: Task["status"] }) {
  const { label, Icon, disc } = STATUS[status] ?? STATUS.done
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "ml-auto flex size-4 shrink-0 items-center justify-center text-muted-foreground",
            disc && "rounded-full bg-highlighter text-highlighter-foreground",
            status === "failed" && "text-destructive"
          )}
        >
          <Icon
            className={cn(
              disc ? "size-2.5" : "size-3.5",
              // Highlighter in dark mode, ink in light (never highlighter on white).
              status === "working" && "animate-spin text-primary"
            )}
            strokeWidth={disc ? 3 : 2}
          />
          <span className="sr-only">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
