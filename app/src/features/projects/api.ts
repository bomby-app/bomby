import { open } from "@tauri-apps/plugin-dialog"

import type {
  Project,
  ProjectAgents,
  ProjectExtensions,
  ProjectInput,
} from "@/generated/projects"
import { call } from "@/lib/core"

// The core's project commands (src-tauri/src/projects.rs), backed by the app's SQLite db.
// The types are generated from the core's structs (`just app types`).

export type {
  CallSummary,
  Project,
  ProjectAgents,
  ProjectExtensions,
  ProjectInput,
} from "@/generated/projects"

/** The longest instructions the core keeps (`MAX_INSTRUCTIONS_LEN` in projects.rs). */
export const MAX_INSTRUCTIONS_LENGTH = 5000

export function listProjects(): Promise<Project[]> {
  return call("list_projects")
}

export function createProject(input: ProjectInput): Promise<Project> {
  return call("create_project", { input })
}

export function updateProject(
  id: number,
  input: ProjectInput
): Promise<Project> {
  return call("update_project", { id, input })
}

/** Which agents the project's calls can hand work to; applies from the next call. */
export function setProjectAgents(
  id: number,
  agents: ProjectAgents
): Promise<Project> {
  return call("set_project_agents", { id, agents })
}

/** Which extensions the project's calls have; applies from the next call. */
export function setProjectExtensions(
  id: number,
  extensions: ProjectExtensions
): Promise<Project> {
  return call("set_project_extensions", { id, extensions })
}

export function deleteProject(id: number): Promise<void> {
  return call("delete_project", { id })
}

/** The native folder picker. Resolves to the chosen folders, or [] when cancelled. */
export async function pickFolders(title: string): Promise<string[]> {
  const picked = await open({
    title,
    directory: true,
    multiple: true,
    canCreateDirectories: true,
  })
  return picked ?? []
}
