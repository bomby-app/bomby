import { FolderCog } from "lucide-react"
import { useState } from "react"

import { Mascot } from "@/components/mascot"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import { CallGate } from "../call/call-gate"
import { useCall } from "../call/call-provider"
import { useCallReadiness } from "../call/use-call-readiness"
import type { Project } from "./api"
import { ProjectSettingsDialog } from "./project-settings-dialog"

/** The project header's settings button, which opens Project settings. */
export function ProjectSettingsButton({
  project,
  onDeleted,
}: {
  project: Project
  onDeleted: () => void
}) {
  const [open, setOpen] = useState(false)
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
        open={open}
        onOpenChange={setOpen}
        onDeleted={onDeleted}
      />
    </>
  )
}

/** Starts a new call on the project: the header's main action, at its right end. */
export function CallButton({ project }: { project: Project }) {
  const { active, starting, start } = useCall()
  const { ready, missing } = useCallReadiness()
  // A new call on this project is starting (not a resume).
  const waking =
    starting?.projectId === project.id && starting.resumeCallId === undefined

  return (
    <CallGate missing={missing}>
      <Button
        size="sm"
        disabled={!ready || active !== null || starting !== null}
        onClick={() => void start(project.id)}
      >
        {/* Dot Dot in the button's own colours: bubble in its text colour, eyes in its fill. */}
        <Mascot
          state={waking ? "waking" : "idle"}
          size={16}
          bubble="currentColor"
          eyes="var(--primary)"
        />
        {waking ? "Waking up..." : "Call"}
      </Button>
    </CallGate>
  )
}
