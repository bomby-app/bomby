import { FolderClosed, GitCompareArrows, SquareTerminal } from "lucide-react"
import { createElement, type ReactNode } from "react"

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
  /** Words the command palette also finds it by, beyond its label. */
  keywords?: string[]
}

/**
 * The folder's panels: Changes, Files and Terminal for a project with a folder, none
 * without. Changes is there for a folder outside git too, where it says so, so the folder
 * picker in its header can still choose one of the project's other folders. `repo` is
 * whether the chosen folder is in a git repository (unknown until it's been read), and
 * `changes` how many files changed there, Changes' count only in one; `terminalShortcut`
 * shows or hides Terminal.
 */
export function folderSections({
  folder,
  repo,
  changes,
  terminalShortcut,
}: {
  folder: string | undefined
  repo: boolean | undefined
  changes: number | undefined
  terminalShortcut?: Shortcut
}): Section[] {
  if (folder === undefined) return []
  return [
    {
      id: "changes",
      label: "Changes",
      icon: createElement(GitCompareArrows),
      keywords: ["git", "diff"],
      count: repo ? changes : undefined,
    },
    {
      id: "files",
      label: "Files",
      icon: createElement(FolderClosed),
      keywords: ["folder", "tree"],
    },
    {
      id: "terminal",
      label: "Terminal",
      icon: createElement(SquareTerminal),
      shortcut: terminalShortcut,
      keywords: ["shell", "console"],
    },
  ]
}
