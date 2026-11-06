import { type CodeViewItem, parsePatchFiles } from "@pierre/diffs"
import { CodeView } from "@pierre/diffs/react"
import { GitBranch } from "lucide-react"

import { useDarkMode } from "@/hooks/use-dark-mode"
import { cn } from "@/lib/utils"

import type { ChangedFile, Changes } from "./api"
import { PIERRE_STYLE, pierreTheme } from "./pierre"

/** A cheap fingerprint of a patch, so Pierre redraws a file only when its patch changed. */
function version(patch: string): number {
  let hash = 5381
  for (let i = 0; i < patch.length; i++) {
    hash = (hash * 33) ^ patch.charCodeAt(i)
  }
  return hash >>> 0
}

function items(files: ChangedFile[]): CodeViewItem<undefined>[] {
  return files.flatMap((file) => {
    const fileDiff = file.patch
      ? parsePatchFiles(file.patch)[0]?.files[0]
      : undefined
    return fileDiff
      ? [
          {
            id: file.path,
            type: "diff" as const,
            fileDiff,
            version: version(file.patch),
          },
        ]
      : []
  })
}

/**
 * The folder's changes since the last commit, every file's diff in one scrolling list
 * (Pierre's CodeView: virtualized, with sticky file headers), under a line saying how
 * much changed and on which branch.
 */
export function ChangesView({
  changes,
  branch,
}: {
  changes: Changes
  branch: string | null
}) {
  const dark = useDarkMode()
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

  const shown = items(files)
  const hidden = files.filter((f) => !shown.some((item) => item.id === f.path))

  return (
    <CodeView
      items={shown}
      className="h-full overflow-auto"
      style={PIERRE_STYLE}
      options={{
        ...pierreTheme(dark),
        diffStyle: "unified",
        overflow: "wrap",
        stickyHeaders: true,
        layout: { paddingTop: 0, paddingBottom: 16, gap: 8 },
      }}
      renderCodeViewHeader={() => (
        <Summary
          files={files}
          hidden={hidden}
          truncated={changes.truncated}
          branch={branch}
        />
      )}
    />
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
}: {
  files: ChangedFile[]
  hidden: ChangedFile[]
  truncated: boolean
  branch: string | null
}) {
  const additions = files.reduce((sum, f) => sum + f.additions, 0)
  const deletions = files.reduce((sum, f) => sum + f.deletions, 0)
  return (
    <div className="flex flex-col gap-1.5 px-3 pt-3 pb-2">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">
          {files.length === 1
            ? "1 file changed"
            : `${files.length} files changed`}
        </span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          +{additions} −{deletions}
        </span>
        {branch && <BranchName branch={branch} className="ml-auto" />}
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
