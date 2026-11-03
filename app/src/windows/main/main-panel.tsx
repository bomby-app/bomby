import { FolderOpen, Phone } from "lucide-react"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { callLabel } from "@/features/projects/names"
import { ProjectView } from "@/features/projects/project-view"
import { useProjects } from "@/features/projects/projects-provider"
import type { Selection } from "@/features/projects/selection"
import { AppHeader } from "./app-header"

/** The right side: whatever the sidebar has selected, under the header. */
export function MainPanel({
  selection,
  onSelect,
}: {
  selection: Selection
  onSelect: (selection: Selection) => void
}) {
  const { projects } = useProjects()
  const project = projects?.find((p) => p.id === selection?.projectId)
  const call =
    selection?.kind === "call"
      ? project?.calls.find((c) => c.id === selection.callId)
      : undefined

  // Nothing chosen, or it was deleted.
  if (!project) {
    return (
      <>
        <AppHeader title="Projects" />
        <Placeholder
          icon={<FolderOpen />}
          title={projects?.length === 0 ? "No projects yet" : "Pick a project"}
          description={
            projects?.length === 0
              ? "Add a folder and start talking."
              : "Or start a new one."
          }
        />
      </>
    )
  }

  if (call) {
    return (
      <>
        <AppHeader title={`${project.name} · ${callLabel(call.startedAt)}`} />
        <Placeholder
          icon={<Phone />}
          title="Nothing saved yet"
          description="Saved conversations show here once calls are built."
        />
      </>
    )
  }

  return (
    <>
      <AppHeader title={project.name} />
      <div className="min-h-0 flex-1 overflow-auto">
        <ProjectView
          key={project.id}
          project={project}
          onDeleted={() => onSelect(null)}
        />
      </div>
    </>
  )
}

function Placeholder({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="flex min-h-0 flex-1 overflow-auto">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">{icon}</EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
