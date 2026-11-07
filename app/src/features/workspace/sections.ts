import type { ReactNode } from "react"

import type { Shortcut } from "@/lib/shortcuts"

/** One of a project's panels, as its header toggle and its own header show it. */
export type Section = {
  /** "changes", "files", "terminal", or an extension's tab ("todos"). */
  id: string
  label: string
  icon: ReactNode
  /** Beside the icon on its toggle, and the label in its header, when above 0. */
  count?: number
  shortcut?: Shortcut
}
