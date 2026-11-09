import { Pencil, Play, Trash2 } from "lucide-react"
import { useState } from "react"

import { ErrorCard } from "@/components/error-card"
import { Mascot } from "@/components/mascot"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import { deleteCall } from "../call/api"
import { CallGate } from "../call/call-gate"
import { CallNameInput } from "../call/call-name"
import { useCall } from "../call/call-provider"
import { useCallReadiness } from "../call/use-call-readiness"
import type { CallSummary, Project } from "./api"
import { callLabel, callLength, callTitle } from "./names"
import { useProjects } from "./projects-provider"

/**
 * A project's page: its calls, newest first. A row opens the saved conversation; Resume
 * continues it, with the agent told what was said.
 */
export function ProjectCalls({
  project,
  onOpenCall,
}: {
  project: Project
  onOpenCall: (callId: number) => void
}) {
  const { error } = useCall()

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-8">
      {error?.projectId === project.id && <ErrorCard message={error.message} />}
      {project.calls.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <Mascot state="idle" size={56} />
            </EmptyMedia>
            <EmptyTitle>No calls yet</EmptyTitle>
            <EmptyDescription>
              Press Call up top and start talking.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {project.calls.map((call) => (
            <CallRow
              key={call.id}
              projectId={project.id}
              call={call}
              onOpen={() => onOpenCall(call.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function CallRow({
  projectId,
  call,
  onOpen,
}: {
  projectId: number
  call: CallSummary
  onOpen: () => void
}) {
  const { active } = useCall()
  const live = active?.callId === call.id
  const [renaming, setRenaming] = useState(false)
  const state = live
    ? "On a call now"
    : call.endedAt
      ? callLength(call.activeMs)
      : "Ended early"
  // A named call says when it started under its name; until then, that's its name.
  const detail = call.name ? `${callLabel(call.startedAt)} · ${state}` : state

  return (
    <li className="flex items-center gap-3 py-2 pr-2 pl-3">
      {renaming ? (
        <div className="flex min-w-0 flex-1 items-center gap-3 py-1">
          <Mascot state={live ? "listening" : "idle"} size={28} />
          <CallNameInput
            call={call}
            onDone={() => setRenaming(false)}
            className="max-w-full"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Mascot state={live ? "listening" : "idle"} size={28} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">
              {callTitle(call)}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {detail}
            </span>
          </span>
        </button>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Rename call"
            disabled={renaming}
            onClick={() => setRenaming(true)}
          >
            <Pencil />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Rename call</TooltipContent>
      </Tooltip>
      <ResumeButton projectId={projectId} callId={call.id} />
      <DeleteCallButton call={call} />
    </li>
  )
}

/** Continues an earlier call; the agent hears its last lines. One call at a time. */
export function ResumeButton({
  projectId,
  callId,
}: {
  projectId: number
  callId: number
}) {
  const { active, starting, start } = useCall()
  const { ready, missing } = useCallReadiness()
  return (
    <CallGate missing={missing}>
      <Button
        size="sm"
        // Bubblegum: resuming brings the conversation back (owner's call, docs/brand.md).
        variant="claude"
        disabled={!ready || active !== null || starting !== null}
        onClick={() => void start(projectId, callId)}
      >
        <Play />
        {starting?.resumeCallId === callId ? "Waking up..." : "Resume"}
      </Button>
    </CallGate>
  )
}

/** Deletes a call and its conversation, after asking. Not while it is the live call. */
export function DeleteCallButton({
  call,
  onDeleted,
}: {
  call: CallSummary
  onDeleted?: () => void
}) {
  const { active } = useCall()
  const { refresh } = useProjects()
  const what = call.name
    ? `“${call.name}”`
    : `the call from ${callLabel(call.startedAt)}`

  async function confirm() {
    await deleteCall(call.id)
    await refresh()
    onDeleted?.()
  }

  return (
    <AlertDialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete call"
              disabled={active?.callId === call.id}
            >
              <Trash2 />
            </Button>
          </AlertDialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Delete call</TooltipContent>
      </Tooltip>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {what}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its conversation goes with it. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => void confirm()}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
