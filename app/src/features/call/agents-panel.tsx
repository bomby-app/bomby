import {
  ArrowRight,
  Check,
  CircleQuestionMark,
  CircleSlash,
  Inbox,
  ListEnd,
  LoaderCircle,
  Plus,
  X,
} from "lucide-react"
import { useState } from "react"

import { Mascot } from "@/components/mascot"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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

import { type Task, useTaskRequest, useTasks } from "./tasks"

/**
 * The agents panel in the call's header: a box icon with the number of running tasks,
 * opening the list of what each agent is doing on this call. A task opens what Bomby asked
 * its agent, in full, so the user can catch a request Bomby got wrong.
 */
export function AgentsPanel() {
  const tasks = useTasks()
  const working = tasks.filter((t) => t.status === "working").length
  const [listOpen, setListOpen] = useState(false)
  const [opened, setOpened] = useState<string | null>(null)
  // The task as it is now, so its status keeps up while it's open.
  const task = tasks.find((t) => t.id === opened) ?? null

  return (
    <>
      <Popover open={listOpen} onOpenChange={setListOpen}>
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
                {tasks.map((each) => (
                  <TaskRow
                    key={each.id}
                    task={each}
                    onOpen={() => {
                      setListOpen(false)
                      setOpened(each.id)
                    }}
                  />
                ))}
              </ul>
            </ScrollArea>
          )}
        </PopoverContent>
      </Popover>
      <TaskDialog task={task} onClose={() => setOpened(null)} />
    </>
  )
}

function TaskRow({ task, onOpen }: { task: Task; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full gap-2.5 rounded-md px-2 py-2.5 text-left outline-none hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex size-5 shrink-0 items-center justify-center pt-0.5 text-foreground [&_svg]:size-4">
          <AgentLogo id={task.agent} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{task.session}</span>
            <TaskStatus status={task.status} />
          </span>
          <span className="line-clamp-2 text-xs text-muted-foreground">
            {task.agentName}: {task.task}
          </span>
        </span>
      </button>
    </li>
  )
}

/**
 * What Bomby asked the agent in a task, word for word: Bomby to the agent in its header,
 * the session and status under it, then the request, selectable. The shortened request
 * shows until the full one arrives, and stays if the agent can't send it.
 */
function TaskDialog({
  task,
  onClose,
}: {
  task: Task | null
  onClose: () => void
}) {
  const request = useTaskRequest(task)
  return (
    <Dialog open={task !== null} onOpenChange={(open) => !open && onClose()}>
      {task && (
        <DialogContent className="flex max-h-[80vh] flex-col gap-4 sm:max-w-lg">
          <DialogHeader className="gap-3">
            <div
              aria-hidden
              className="flex items-center gap-2 text-muted-foreground [&_svg]:size-5"
            >
              <Mascot state="idle" size={20} />
              <ArrowRight className="size-4!" />
              <span className="text-foreground">
                <AgentLogo id={task.agent} />
              </span>
            </div>
            <div className="flex items-center gap-2">
              <DialogTitle className="truncate">{task.session}</DialogTitle>
              <TaskStatus status={task.status} />
            </div>
            <DialogDescription>
              What Bomby asked {task.agentName}, word for word.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="min-h-0 flex-1 rounded-md border bg-muted/40">
            <p className="p-3 text-sm whitespace-pre-wrap select-text">
              {request.state === "read" ? request.text : task.task}
            </p>
          </ScrollArea>
          {request.state === "failed" && task.task.endsWith("…") && (
            <p className="text-xs text-muted-foreground">
              Bomby couldn&apos;t send the rest, so this is the start of it.
            </p>
          )}
        </DialogContent>
      )}
    </Dialog>
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

/**
 * A status this page doesn't know (a newer agent's): neutral, never a claim that the task
 * is done.
 */
const UNKNOWN_STATUS = {
  label: "Status unknown",
  Icon: CircleQuestionMark,
  disc: "bg-muted text-muted-foreground",
}

function TaskStatus({ status }: { status: Task["status"] }) {
  // Own keys only: a status such as "constructor" must not find the object's prototype.
  const { label, Icon, disc } = Object.hasOwn(STATUS, status)
    ? STATUS[status]
    : UNKNOWN_STATUS
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
