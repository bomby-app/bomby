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
