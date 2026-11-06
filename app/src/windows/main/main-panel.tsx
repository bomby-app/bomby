import type { ReactNode } from "react"

import { AgentsPanel } from "@/features/call/agents-panel"
import { useCall } from "@/features/call/call-provider"
import { CallView } from "@/features/call/call-view"
import { SavedCallView } from "@/features/call/saved-call-view"
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

/** The header's actions, then the workspace panel's toggle when the project has one. */
function Actions({
  children,
  toggle,
}: {
  children: ReactNode
  toggle: ReactNode
}) {
  return (
    <div className="flex items-center gap-1.5">
      {children}
      {toggle}
    </div>
  )
}

/**
 * The right side: whatever the sidebar has selected, under the header. A project, its
 * live call and its past calls share one workspace layout, so moving between them keeps
 * the workspace panel and its terminals.
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

  // The running call (the session lives in CallProvider, above the panels).
  const live =
    active?.projectId === project.id &&
    (selection?.kind === "project" ||
      (selection?.kind === "call" && selection.callId === active.callId))
  if (live) {
    return (
      <WorkspaceLayout
        key={project.id}
        project={project}
        header={(toggle) => (
          <AppHeader
            title={`${project.name} · On a call`}
            actions={
              <Actions toggle={toggle}>
                <AgentsPanel />
              </Actions>
            }
          />
        )}
      >
        <div className="min-h-0 flex-1">
          <CallView call={active} />
        </div>
      </WorkspaceLayout>
    )
  }

  if (call) {
    return (
      <WorkspaceLayout
        key={project.id}
        project={project}
        header={(toggle) => (
          <AppHeader
            title={`${project.name} · ${callLabel(call.startedAt)}`}
            actions={
              <Actions toggle={toggle}>
                <DeleteCallButton
                  call={call}
                  onDeleted={() =>
                    onSelect({ kind: "project", projectId: project.id })
                  }
                />
                <ResumeButton projectId={project.id} callId={call.id} />
              </Actions>
            }
          />
        )}
      >
        <SavedCallView key={call.id} callId={call.id} />
      </WorkspaceLayout>
    )
  }

  return (
    <WorkspaceLayout
      key={project.id}
      project={project}
      header={(toggle) => (
        <AppHeader
          title={project.name}
          actions={
            <Actions toggle={toggle}>
              <ProjectActions
                project={project}
                onDeleted={() => onSelect(null)}
              />
            </Actions>
          }
        />
      )}
    >
      <div className="min-h-0 flex-1 overflow-auto">
        <ProjectCalls
          project={project}
          onOpenCall={(callId) =>
            onSelect({ kind: "call", projectId: project.id, callId })
          }
        />
      </div>
    </WorkspaceLayout>
  )
}
