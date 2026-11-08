import type { ReactNode } from "react"

/**
 * A panel another feature adds beside the folder's (an extension's, such as To-dos), with a
 * toggle in the project's header that opens it.
 */
export type ExtraTab = {
  id: string
  label: string
  /** Shown in its header and on its toggle when above 0, such as open to-dos. */
  count?: number
  /** Its toggle's icon. */
  icon: ReactNode
  content: ReactNode
}
