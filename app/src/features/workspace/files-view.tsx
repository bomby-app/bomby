import { File as CodeFile } from "@pierre/diffs/react"
import {
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  LoaderCircle,
  X,
} from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useDarkMode } from "@/hooks/use-dark-mode"
import { cn } from "@/lib/utils"

import { type Entry, folderEntries, folderFile } from "./api"
import { PIERRE_STYLE, pierreTheme } from "./pierre"
import { STATUS_COLOR, type TreeStatuses } from "./status"
import { StatusLetter } from "./status-letter"
import { useReading } from "./use-folder"

/** Each level of the tree sits this much further in. */
const INDENT_PX = 12

type Place = { projectId: number; folder: string; version: number }

/**
 * The folder's files as a tree that opens one directory at a time, and the chosen file's
 * text under it. Changed files carry their git status, in its colour, and a folder with
 * changes inside gets a dot; ignored files (`node_modules`, build output) are dimmed.
 */
export function FilesView({
  statuses,
  ...place
}: Place & { statuses: TreeStatuses }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const [selected, setSelected] = useState<string | null>(null)

  function toggle(dir: string) {
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })
  }

  const tree = (
    <ScrollArea className="h-full">
      <div className="py-1.5">
        <Directory
          {...place}
          statuses={statuses}
          dir=""
          depth={0}
          open={open}
          selected={selected}
          onToggle={toggle}
          onSelect={setSelected}
        />
      </div>
    </ScrollArea>
  )

  if (!selected) return tree
  return (
    <ResizablePanelGroup orientation="vertical">
      <ResizablePanel id="tree" defaultSize="45%" minSize={80}>
        {tree}
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="preview" minSize={120}>
        <Preview {...place} file={selected} onClose={() => setSelected(null)} />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

function Directory({
  projectId,
  folder,
  version,
  statuses,
  dir,
  depth,
  open,
  selected,
  onToggle,
  onSelect,
}: Place & {
  statuses: TreeStatuses
  dir: string
  depth: number
  open: ReadonlySet<string>
  selected: string | null
  onToggle: (dir: string) => void
  onSelect: (file: string) => void
}) {
  const reading = useReading(`${folder}\n${dir}`, version, () =>
    folderEntries(projectId, folder, dir)
  )
  const padding = { paddingLeft: 8 + depth * INDENT_PX + 16 }

  if (reading.loading) {
    return (
      <div className="flex h-7 items-center" style={padding}>
        <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (reading.error || !reading.data) {
    return (
      <p className="py-1 text-xs text-muted-foreground" style={padding}>
        Couldn't open this folder.
      </p>
    )
  }
  if (reading.data.length === 0) {
    return (
      <p className="py-1 text-xs text-muted-foreground" style={padding}>
        Empty
      </p>
    )
  }

  return (
    <div>
      {reading.data.map((entry) => (
        <div key={entry.path}>
          <Row
            entry={entry}
            depth={depth}
            expanded={open.has(entry.path)}
            selected={selected === entry.path}
            statuses={statuses}
            onClick={() =>
              entry.dir ? onToggle(entry.path) : onSelect(entry.path)
            }
          />
          {entry.dir && open.has(entry.path) && (
            <Directory
              projectId={projectId}
              folder={folder}
              version={version}
              statuses={statuses}
              dir={entry.path}
              depth={depth + 1}
              open={open}
              selected={selected}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          )}
        </div>
      ))}
    </div>
  )
}

function Row({
  entry,
  depth,
  expanded,
  selected,
  statuses,
  onClick,
}: {
  entry: Entry
  depth: number
  expanded: boolean
  selected: boolean
  statuses: TreeStatuses
  onClick: () => void
}) {
  const Icon = entry.dir ? (expanded ? FolderOpen : Folder) : FileIcon
  const status = entry.dir ? undefined : statuses.files.get(entry.path)
  const changedInside = entry.dir && statuses.dirs.has(entry.path)
  return (
    <button
      type="button"
      aria-expanded={entry.dir ? expanded : undefined}
      aria-current={selected || undefined}
      onClick={onClick}
      style={{ paddingLeft: 8 + depth * INDENT_PX }}
      className={cn(
        "mx-1.5 flex h-7 w-[calc(100%-12px)] items-center gap-1.5 rounded-sm pr-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
        selected && "bg-accent font-medium",
        entry.ignored && "text-muted-foreground",
        status && STATUS_COLOR[status]
      )}
    >
      <ChevronRight
        className={cn(
          "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ease-out",
          !entry.dir && "invisible",
          expanded && "rotate-90"
        )}
      />
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{entry.name}</span>
      {status && <StatusLetter status={status} className="ml-auto" />}
      {changedInside && (
        <span
          aria-label="Has changes"
          className="mr-1 ml-auto size-1.5 shrink-0 rounded-full bg-change-modified"
        />
      )}
    </button>
  )
}

function Preview({
  projectId,
  folder,
  version,
  file,
  onClose,
}: Place & { file: string; onClose: () => void }) {
  const dark = useDarkMode()
  const reading = useReading(`${folder}\n${file}`, version, () =>
    folderFile(projectId, folder, file)
  )
  const text = reading.data?.text

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b pr-1.5 pl-3">
        <span className="truncate font-mono text-xs" title={file}>
          {file}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto"
          aria-label="Close the file"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 [scrollbar-gutter:stable] overflow-auto">
        {reading.loading ? null : text != null ? (
          <CodeFile
            file={{ name: file, contents: text }}
            style={PIERRE_STYLE}
            options={{
              ...pierreTheme(dark),
              overflow: "wrap",
              disableFileHeader: true,
            }}
          />
        ) : (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            {reading.error
              ? "Couldn't open this file."
              : "This file is binary or too big to show here."}
          </p>
        )}
      </div>
    </div>
  )
}
