import type { ChangeStatus, Changes } from "./api"

// How a file's git status shows, the same in the diff headers and the file tree: a
// letter, as editors show it, in the change colours (`--change-*` in index.css).

export const STATUS_LETTER: Record<ChangeStatus, string> = {
  added: "A",
  untracked: "U",
  modified: "M",
  renamed: "R",
  typechange: "T",
  deleted: "D",
}

export const STATUS_LABEL: Record<ChangeStatus, string> = {
  added: "Added",
  untracked: "New, not in git yet",
  modified: "Modified",
  renamed: "Renamed",
  typechange: "Changed type",
  deleted: "Deleted",
}

export const STATUS_COLOR: Record<ChangeStatus, string> = {
  added: "text-change-added",
  untracked: "text-change-added",
  modified: "text-change-modified",
  renamed: "text-change-modified",
  typechange: "text-change-modified",
  deleted: "text-change-deleted",
}

export type TreeStatuses = {
  /** Each changed file by its path in the folder, as the tree names it. */
  files: ReadonlyMap<string, ChangeStatus>
  /** Every folder, by its path in the folder, with a changed file somewhere inside. */
  dirs: ReadonlySet<string>
}

const NONE: TreeStatuses = { files: new Map(), dirs: new Set() }

/**
 * The changes as the file tree needs them. Changes name files from the repository's
 * root; the tree, from the folder, which may be a folder inside the repository.
 */
export function treeStatuses(
  changes: Changes | null | undefined
): TreeStatuses {
  if (!changes) return NONE
  const prefix = changes.within ? `${changes.within}/` : ""
  const files = new Map<string, ChangeStatus>()
  const dirs = new Set<string>()
  for (const file of changes.files) {
    if (!file.path.startsWith(prefix)) continue
    const path = file.path.slice(prefix.length)
    files.set(path, file.status)
    const parts = path.split("/")
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"))
    }
  }
  return { files, dirs }
}

/** A path's folder part (with its `/`) and its name, for showing the name first. */
export function splitPath(path: string): [dir: string, name: string] {
  const slash = path.lastIndexOf("/")
  return slash === -1
    ? ["", path]
    : [path.slice(0, slash + 1), path.slice(slash + 1)]
}
