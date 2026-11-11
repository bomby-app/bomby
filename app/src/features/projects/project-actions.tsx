import { FolderCog } from "lucide-react"
import { useState } from "react"

import { Mascot } from "@/components/mascot"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useStore } from "@/lib/store"

import { CallGate } from "../call/call-gate"
import { useCall } from "../call/call-provider"
import { useCallReadiness } from "../call/use-call-readiness"
import type { Project } from "./api"
import { ProjectSettingsDialog } from "./project-settings-dialog"
import { settingsRequest } from "./settings-request"

/**
 * The project header's settings button, which opens Project settings, as does a request
 * for this project from the command palette (`settings-request.ts`).
 */
export function ProjectSettingsButton({
  project,
  onDeleted,
}: {
  project: Project
  onDeleted: () => void
}) {
  const [clicked, setClicked] = useState(false)
  const requested = useStore(settingsRequest) === project.id
  function setOpen(open: boolean) {
    setClicked(open)
    if (!open && requested) settingsRequest.set(null)
  }
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Project settings"
            onClick={() => setOpen(true)}
          >
            <FolderCog />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Project settings</TooltipContent>
      </Tooltip>
      <ProjectSettingsDialog
        project={project}
        open={clicked || requested}
        onOpenChange={setOpen}
        onDeleted={onDeleted}
      />
    </>
  )
}

/** Starts a new call on the project: the header's main action, at its right end. */
export function CallButton({ project }: { project: Project }) {
  const { active, starting, start, cancel } = useCall()
  const { ready, missing } = useCallReadiness()
  // A new call on this project is starting (not a resume).
  const waking =
    starting?.projectId === project.id && starting.resumeCallId === undefined

  if (waking)
    return (
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={cancel}>
          Cancel
        </Button>
        <Button size="sm" disabled>
          <Mascot
            state="waking"
            size={16}
            bubble="currentColor"
            eyes="var(--primary)"
          />
          Waking up...
        </Button>
      </div>
    )

  return (
    <CallGate missing={missing}>
      <Button
        size="sm"
        disabled={!ready || active !== null || starting !== null}
        onClick={() => void start(project.id)}
      >
        {/* The mascot in the button's own colours: bubble in its text colour, eyes in its fill. */}
        <Mascot
          state="idle"
          size={16}
          bubble="currentColor"
          eyes="var(--primary)"
        />
        Call
      </Button>
    </CallGate>
  )
}
