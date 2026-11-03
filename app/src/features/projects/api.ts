import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"

// The core's project commands (src-tauri/src/projects.rs), backed by the app's SQLite db.

export type CallSummary = {
  id: number
  /** Milliseconds since the epoch. */
  startedAt: number
  endedAt: number | null
}

export type Project = {
  id: number
  name: string
  /** In order; the first is Claude's working folder. */
  folders: string[]
  createdAt: number
  /** Newest first. */
  calls: CallSummary[]
}

export type ProjectInput = { name: string; folders: string[] }

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
