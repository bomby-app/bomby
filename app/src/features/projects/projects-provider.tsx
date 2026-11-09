import { createContext, type ReactNode, use, useEffect, useState } from "react"

import { onCallRenamed } from "@/features/call/api"
import { useCoreEvent } from "@/hooks/use-core-event"

import {
  createProject,
  deleteProject,
  listProjects,
  type Project,
  type ProjectAgents,
  type ProjectExtensions,
  type ProjectInput,
  setProjectAgents,
  setProjectExtensions,
  updateProject,
} from "./api"

type ProjectsState = {
  /** null until the first load finishes. */
  projects: Project[] | null
  create: (input: ProjectInput) => Promise<Project>
  update: (id: number, input: ProjectInput) => Promise<Project>
  setAgents: (id: number, agents: ProjectAgents) => Promise<Project>
  setExtensions: (id: number, extensions: ProjectExtensions) => Promise<Project>
  remove: (id: number) => Promise<void>
  /** Reloads the tree, after something outside this provider changed it (a call). */
  refresh: () => Promise<void>
}

const ProjectsContext = createContext<ProjectsState | null>(null)

/**
 * Holds the project tree for a window. Every change goes to the core first; the list is
 * then reloaded from it, so the page never drifts from the database.
 */
export function ProjectsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[] | null>(null)

  async function reload() {
    setProjects(await listProjects())
  }

  // The first load from the core; the list lands when it answers.
  useEffect(() => {
    void listProjects().then(setProjects)
  }, [])

  // A call renamed by the user in another window, or by Bomby mid-call.
  useCoreEvent(onCallRenamed, () => void reload())

  const state: ProjectsState = {
    projects,
    create: async (input) => {
      const project = await createProject(input)
      await reload()
      return project
    },
    update: async (id, input) => {
      const project = await updateProject(id, input)
      await reload()
      return project
    },
    setAgents: async (id, agents) => {
      const project = await setProjectAgents(id, agents)
      await reload()
      return project
    },
    setExtensions: async (id, extensions) => {
      const project = await setProjectExtensions(id, extensions)
      await reload()
      return project
    },
    remove: async (id) => {
      await deleteProject(id)
      await reload()
    },
    refresh: reload,
  }

  return <ProjectsContext value={state}>{children}</ProjectsContext>
}

export function useProjects(): ProjectsState {
  const state = use(ProjectsContext)
  if (!state)
    throw new Error("useProjects must be used inside ProjectsProvider")
  return state
}
