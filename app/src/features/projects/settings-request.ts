import { createStore } from "@/lib/store"

/**
 * A project whose settings to open, from outside its page (the command palette), until its
 * page's settings button opens them.
 */
export const settingsRequest = createStore<number | null>(null)

export function openProjectSettings(projectId: number) {
  settingsRequest.set(projectId)
}
