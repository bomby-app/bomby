import { createStore } from "@/lib/store"

import type { Section } from "./sections"

/** A project's panels as the command palette sees them: which there are, and how to show one. */
export type ProjectPanels = {
  projectId: number
  sections: Section[]
  /** Shows the panel `id` ("changes", "files", "terminal", "todos"), never closing it. */
  show: (id: string) => void
}

/** The open project's panels; null while no project's page is open. */
export const projectPanels = createStore<ProjectPanels | null>(null)

/**
 * A panel to open with a project's page that isn't open yet (the to-do toast's Show, from
 * another project): its workspace starts with it open, then lets it go.
 */
export const panelRequest = createStore<{
  projectId: number
  id: string
} | null>(null)

/** Shows the panel `id` of `projectId`'s page: now if it's open, else once it opens. */
export function showProjectPanel(projectId: number, id: string) {
  const panels = projectPanels.get()
  if (panels?.projectId === projectId) panels.show(id)
  else panelRequest.set({ projectId, id })
}
