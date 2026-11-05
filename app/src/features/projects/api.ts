import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"

import type { Project, ProjectInput } from "@/generated/projects"

// The core's project commands (src-tauri/src/projects.rs), backed by the app's SQLite db.
// The types are generated from the core's structs (`just app types`).

export type { CallSummary, Project, ProjectInput } from "@/generated/projects"

/** The longest instructions the core keeps (`MAX_INSTRUCTIONS_LEN` in projects.rs). */
export const MAX_INSTRUCTIONS_LENGTH = 5000

export function listProjects(): Promise<Project[]> {
  return invoke("list_projects")
}

export function createProject(input: ProjectInput): Promise<Project> {
  return invoke("create_project", { input })
}

export function updateProject(
  id: number,
  input: ProjectInput
): Promise<Project> {
  return invoke("update_project", { id, input })
}

export function deleteProject(id: number): Promise<void> {
  return invoke("delete_project", { id })
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
