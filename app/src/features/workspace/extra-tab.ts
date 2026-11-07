import type { ReactNode } from "react"

/**
 * A tab another feature adds to the workspace panel, beside the folder's (an extension's,
 * such as To-dos), with a button in the project's header that opens the panel on it.
 */
export type ExtraTab = {
  id: string
  label: string
  /** Shown beside the label and on the header button when above 0, such as open to-dos. */
  count?: number
  /** The header button's icon. */
  icon: ReactNode
  content: ReactNode
}
