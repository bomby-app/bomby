import type { Project } from "./api"

/** When a project's newest call started, or null before its first (calls are newest first). */
export function lastCall(project: Project): number | null {
  return project.calls[0]?.startedAt ?? null
}

/** The newest call first; projects without one after, newest first. */
function byNewestCall(a: Project, b: Project): number {
  const [x, y] = [lastCall(a), lastCall(b)]
  if (x !== null && y !== null) return y - x
  if (x !== null) return -1
  if (y !== null) return 1
  return b.createdAt - a.createdAt
}

/** How many recent projects show at first: the projects home (before See all) and the menu bar. */
export const RECENT_COUNT = 3

/** The projects, most recently used first: the projects home and the menu bar list them so. */
export function recentProjects(projects: readonly Project[]): Project[] {
  return [...projects].sort(byNewestCall)
}
