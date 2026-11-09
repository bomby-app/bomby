import type { ReactNode } from "react"

import { AgentsPanel } from "@/features/call/agents-panel"
import { type ActiveCall, useCall } from "@/features/call/call-provider"
import { CallView } from "@/features/call/call-view"
import { SavedCallView } from "@/features/call/saved-call-view"
import { isOn, useExtensions } from "@/features/extensions/use-extensions"
import type { CallSummary, Project } from "@/features/projects/api"
import { callLabel } from "@/features/projects/names"
import {
  CallButton,
  ProjectSettingsButton,
} from "@/features/projects/project-actions"
import {
  DeleteCallButton,
  ProjectCalls,
  ResumeButton,
} from "@/features/projects/project-calls"
import { ProjectsHome } from "@/features/projects/projects-home"
import { useProjects } from "@/features/projects/projects-provider"
import type { Selection } from "@/features/projects/selection"
import {
  forgetProjectTodos,
  TodoDialogs,
  TODOS_TAB,
  TodosView,
  useOpenCount,
} from "@/features/todos/todos-view"
import type { ExtraTab } from "@/features/workspace/extra-tab"
import { projectPanels } from "@/features/workspace/panel-requests"
import { WorkspaceLayout } from "@/features/workspace/workspace-layout"

import { AppHeader } from "./app-header"

/**
 * The right side: whatever the sidebar has selected, under the header. A project, its
 * live call and its past calls are one workspace layout (same component, same key), so
 * moving between them keeps the workspace panel, its terminals and its to-dos.
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
  return <ProjectLayout key={project.id} project={project} view={view} />
}

/**
 * A project's page in the workspace layout, with the tabs its extensions add to the panel
 * (To-dos, when the project's calls have it) and its to-do dialogs (a new one with notes, one expanded).
 */
function ProjectLayout({
  project,
  view,
}: {
  project: Project
  view: ProjectView
}) {
  const extensions = useExtensions()
  const todosOn = isOn("todos", project.extensions, extensions)
  const openTodos = useOpenCount(project.id, todosOn)
  const tabs: ExtraTab[] = todosOn
    ? [
        {
          ...TODOS_TAB,
          count: openTodos,
          content: <TodosView projectId={project.id} />,
        },
      ]
    : []
  return (
    <>
      {todosOn && (
        <TodoDialogs
          projectId={project.id}
          onShow={() => {
            const panels = projectPanels.get()
            if (panels?.projectId === project.id) panels.show("todos")
          }}
        />
      )}
      <WorkspaceLayout
        project={project}
        tabs={tabs}
        header={(toggles) => (
          <AppHeader
            title={view.title}
            actions={
              // The page's own actions, its panels' toggles, then its main action on its
              // own at the right end (owner, 2026-11-08).
              <div className="flex items-center gap-1.5">
                {view.secondary}
                {toggles}
                {view.primary && <div className="ml-1.5">{view.primary}</div>}
              </div>
            }
          />
        )}
      >
        {view.body}
      </WorkspaceLayout>
    </>
  )
}

type ProjectView = {
  title: string
  /** Before the panels' toggles: settings, delete. */
  secondary?: ReactNode
  /** The page's main action, at the header's right end: Call, Resume, the call's agents. */
  primary?: ReactNode
  body: ReactNode
}

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
      primary: <AgentsPanel />,
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
      secondary: (
        <DeleteCallButton
          call={call}
          onDeleted={() => onSelect({ kind: "project", projectId: project.id })}
        />
      ),
      primary: <ResumeButton projectId={project.id} callId={call.id} />,
      body: <SavedCallView key={call.id} callId={call.id} />,
    }
  }
  return {
    title: project.name,
    secondary: (
      <ProjectSettingsButton
        project={project}
        onDeleted={() => {
          // SQLite may give a new project its id: nothing of this one may show there.
          forgetProjectTodos(project.id)
          onSelect(null)
        }}
      />
    ),
    primary: <CallButton project={project} />,
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
