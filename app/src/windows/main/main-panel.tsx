import type { ReactNode } from "react"

import { AgentsPanel } from "@/features/call/agents-panel"
import { type ActiveCall, useCall } from "@/features/call/call-provider"
import { CallView } from "@/features/call/call-view"
import { SavedCallView } from "@/features/call/saved-call-view"
import type { CallSummary, Project } from "@/features/projects/api"
import { callLabel } from "@/features/projects/names"
import { ProjectActions } from "@/features/projects/project-actions"
import {
  DeleteCallButton,
  ProjectCalls,
  ResumeButton,
} from "@/features/projects/project-calls"
import { ProjectsHome } from "@/features/projects/projects-home"
import { useProjects } from "@/features/projects/projects-provider"
import type { Selection } from "@/features/projects/selection"
import { WorkspaceLayout } from "@/features/workspace/workspace-layout"

import { AppHeader } from "./app-header"

/**
 * The right side: whatever the sidebar has selected, under the header. A project, its
 * live call and its past calls are one workspace layout (same component, same key), so
 * moving between them keeps the workspace panel and its terminals.
 */
export function MainPanel({
  selection,
  onSelect,
  onNewProject,
}: {
  selection: Selection
  onSelect: (selection: Selection) => void
  onNewProject: () => void
}) {
  const { projects } = useProjects()
  const { active } = useCall()
  const project = projects?.find((p) => p.id === selection?.projectId)
  const call =
    selection?.kind === "call"
      ? project?.calls.find((c) => c.id === selection.callId)
      : undefined

  // Nothing chosen, or it was deleted: the projects home.
  if (!project) {
    return (
      <>
        <AppHeader title="Projects" />
        {projects && (
          <ProjectsHome
            projects={projects}
            onOpen={(projectId) => onSelect({ kind: "project", projectId })}
            onNewProject={onNewProject}
          />
        )}
      </>
    )
  }

  const view = projectView(project, selection, active, call, onSelect)
  return (
    <WorkspaceLayout
      key={project.id}
      project={project}
      header={(toggle) => (
        <AppHeader
          title={view.title}
          actions={
            <div className="flex items-center gap-1.5">
              {view.actions}
              {toggle}
            </div>
          }
        />
      )}
    >
      {view.body}
    </WorkspaceLayout>
  )
}

type ProjectView = { title: string; actions: ReactNode; body: ReactNode }

/** What a project's page shows: its running call, one of its past calls, or its calls. */
function projectView(
  project: Project,
  selection: Selection,
  active: ActiveCall | null,
  call: CallSummary | undefined,
  onSelect: (selection: Selection) => void
): ProjectView {
  // The running call (the session lives in CallProvider, above the panels).
  const live =
    active?.projectId === project.id &&
    (selection?.kind === "project" ||
      (selection?.kind === "call" && selection.callId === active.callId))
  if (live) {
    return {
      title: `${project.name} · On a call`,
      actions: <AgentsPanel />,
      body: (
        <div className="min-h-0 flex-1">
          <CallView call={active} />
        </div>
      ),
    }
  }
  if (call) {
    return {
      title: `${project.name} · ${callLabel(call.startedAt)}`,
      actions: (
        <>
          <DeleteCallButton
            call={call}
            onDeleted={() =>
              onSelect({ kind: "project", projectId: project.id })
            }
          />
          <ResumeButton projectId={project.id} callId={call.id} />
        </>
      ),
      body: <SavedCallView key={call.id} callId={call.id} />,
    }
  }
  return {
    title: project.name,
    actions: (
      <ProjectActions project={project} onDeleted={() => onSelect(null)} />
    ),
    body: (
      <div className="min-h-0 flex-1 overflow-auto">
        <ProjectCalls
          project={project}
          onOpenCall={(callId) =>
            onSelect({ kind: "call", projectId: project.id, callId })
          }
        />
      </div>
    ),
  }
}
