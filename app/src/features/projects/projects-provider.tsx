import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useState,
} from "react"

import {
  createProject,
  deleteProject,
  listProjects,
  type Project,
  type ProjectInput,
  updateProject,
} from "./api"

type ProjectsState = {
  /** null until the first load finishes. */
  projects: Project[] | null
  create: (input: ProjectInput) => Promise<Project>
  update: (id: number, input: ProjectInput) => Promise<Project>
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

  const reload = useCallback(async () => {
    setProjects(await listProjects())
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

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
