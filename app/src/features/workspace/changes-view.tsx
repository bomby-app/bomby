import { type CodeViewItem, parsePatchFiles } from "@pierre/diffs"
import { CodeView } from "@pierre/diffs/react"
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  GitBranch,
} from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useDarkMode } from "@/hooks/use-dark-mode"
import { cn } from "@/lib/utils"

import type { ChangedFile, Changes } from "./api"
import { PIERRE_STYLE, pierreTheme } from "./pierre"
import { splitPath } from "./status"
import { StatusLetter } from "./status-letter"

/** A cheap fingerprint of a patch, so Pierre redraws a file only when its patch changed. */
function fingerprint(patch: string): number {
  let hash = 5381
  for (let i = 0; i < patch.length; i++) {
    hash = (hash * 33) ^ patch.charCodeAt(i)
  }
  return hash >>> 0
}

/**
 * Pierre's items for the files with a patch. CodeView redraws an item only when its
 * `version` changes, so the version covers both the patch and whether it's collapsed.
 */
function items(
  files: ChangedFile[],
  collapsed: ReadonlySet<string>
): CodeViewItem<undefined>[] {
  return files.flatMap((file) => {
    const fileDiff = file.patch
      ? parsePatchFiles(file.patch)[0]?.files[0]
      : undefined
    if (!fileDiff) return []
    const folded = collapsed.has(file.path)
    return [
      {
        id: file.path,
        type: "diff" as const,
        fileDiff,
        collapsed: folded,
        version: fingerprint(file.patch) * 2 + (folded ? 1 : 0),
      },
    ]
  })
}

/**
 * The folder's changes since the last commit, every file's diff in one scrolling list
 * (Pierre's CodeView: virtualized, with sticky file headers in our own design), under a
 * line saying how much changed and on which branch. Each file folds from its header; the
 * line above folds or opens them all.
 */
export function ChangesView({
  changes,
  branch,
}: {
  changes: Changes
  branch: string | null
}) {
  const dark = useDarkMode()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const { files } = changes

  if (files.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
        <p className="text-sm font-medium">Nothing's changed yet.</p>
        <p className="text-sm text-muted-foreground">
          What the agent changes shows up here as it works.
        </p>
        {branch && <BranchName branch={branch} className="mt-2" />}
      </div>
    )
  }

  const shown = items(files, collapsed)
  const byPath = new Map(files.map((f) => [f.path, f]))
  const hidden = files.filter((f) => !shown.some((item) => item.id === f.path))
  const allCollapsed = shown.every((item) => collapsed.has(item.id))

  function toggle(path: string) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <CodeView
      items={shown}
      // The scroll bar's room is kept even before the list is long enough to need it,
      // so the headers don't shift when the diffs arrive.
      className="h-full [scrollbar-gutter:stable] overflow-auto"
      style={PIERRE_STYLE}
      options={{
        ...pierreTheme(dark),
        diffStyle: "unified",
        overflow: "wrap",
        stickyHeaders: true,
        layout: { paddingTop: 0, paddingBottom: 16, gap: 8 },
      }}
      renderCustomHeader={(item) => {
        const file = byPath.get(item.id)
        return file ? (
          <FileHeader
            file={file}
            collapsed={collapsed.has(file.path)}
            onToggle={() => toggle(file.path)}
          />
        ) : null
      }}
      renderCodeViewHeader={() => (
        <Summary
          files={files}
          hidden={hidden}
          truncated={changes.truncated}
          branch={branch}
          allCollapsed={allCollapsed}
          onCollapseAll={() =>
            setCollapsed(
              allCollapsed ? new Set() : new Set(shown.map((item) => item.id))
            )
          }
        />
      )}
    />
  )
}

/** As tall as Pierre's virtualizer expects a header to be (`diffHeaderHeight`, 44 px). */
function FileHeader({
  file,
  collapsed,
  onToggle,
}: {
  file: ChangedFile
  collapsed: boolean
  onToggle: () => void
}) {
  const [dir, name] = splitPath(file.path)
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      onClick={onToggle}
      className="flex h-11 w-full min-w-0 items-center gap-2 bg-background px-3 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <ChevronRight
        className={cn(
          "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ease-out",
          !collapsed && "rotate-90"
        )}
      />
      <StatusLetter status={file.status} />
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 text-sm font-medium">{name}</span>
        {(file.oldPath ?? dir) && (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {file.oldPath ? `from ${file.oldPath}` : dir}
          </span>
        )}
      </span>
      <Counts
        additions={file.additions}
        deletions={file.deletions}
        className="ml-auto"
      />
    </button>
  )
}

function Counts({
  additions,
  deletions,
  className,
}: {
  additions: number
  deletions: number
  className?: string
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 gap-1.5 font-mono text-xs tabular-nums",
        className
      )}
    >
      {additions > 0 && <span className="text-change-added">+{additions}</span>}
      {deletions > 0 && (
        <span className="text-change-deleted">−{deletions}</span>
      )}
    </span>
  )
}

function BranchName({
  branch,
  className,
}: {
  branch: string
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1 font-mono text-xs text-muted-foreground",
        className
      )}
    >
      <GitBranch className="size-3 shrink-0" />
      <span className="truncate">{branch}</span>
    </span>
  )
}

function Summary({
  files,
  hidden,
  truncated,
  branch,
  allCollapsed,
  onCollapseAll,
}: {
  files: ChangedFile[]
  hidden: ChangedFile[]
  truncated: boolean
  branch: string | null
  allCollapsed: boolean
  onCollapseAll: () => void
}) {
  const additions = files.reduce((sum, f) => sum + f.additions, 0)
  const deletions = files.reduce((sum, f) => sum + f.deletions, 0)
  const label = allCollapsed ? "Expand all files" : "Collapse all files"
  return (
    <div className="flex flex-col gap-1.5 pt-2 pr-2 pb-2 pl-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 text-sm font-medium">
          {files.length === 1
            ? "1 file changed"
            : `${files.length} files changed`}
        </span>
        <Counts additions={additions} deletions={deletions} />
        <span className="ml-auto flex min-w-0 items-center gap-1">
          {branch && <BranchName branch={branch} />}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={label}
                onClick={onCollapseAll}
              >
                {allCollapsed ? <ChevronsUpDown /> : <ChevronsDownUp />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        </span>
      </div>
      {hidden.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {truncated
            ? "Some changes are too big to show here: "
            : "Not shown, binary or too big: "}
          <span className="font-mono">
            {hidden.map((f) => f.path).join(", ")}
          </span>
        </p>
      )}
    </div>
  )
}
