import { Settings2 } from "lucide-react"
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

/** The project header's buttons: start a new call, and the project's settings. */
export function ProjectActions({
  project,
  onDeleted,
}: {
  project: Project
  onDeleted: () => void
}) {
  const { active, starting, start } = useCall()
  const { ready, missing } = useCallReadiness()
  const [settingsOpen, setSettingsOpen] = useState(false)
  // A new call on this project is starting (not a resume).
  const waking =
    starting?.projectId === project.id && starting.resumeCallId === undefined

  return (
    <div className="flex items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Project settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Project settings</TooltipContent>
      </Tooltip>
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
      <ProjectSettingsDialog
        project={project}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onDeleted={onDeleted}
      />
    </div>
  )
}
