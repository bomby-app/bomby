import { Folder, Plus, X } from "lucide-react"
import { Tabs as TabsPrimitive } from "radix-ui"
import { useState } from "react"

import { ErrorCard } from "@/components/error-card"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { folderChanges, folderInfo } from "./api"
import { ChangesView } from "./changes-view"
import { FilesView } from "./files-view"
import { treeStatuses } from "./status"
import { TerminalView } from "./terminal-view"
import { useFolderVersion, useReading } from "./use-folder"

type TerminalTab = {
  id: number
  folder: string
  /** What the shell last called itself (OSC 0/2), if anything. */
  title: string | null
}

/** The last part of a path: what a folder is called. */
function folderName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path
}

/**
 * The workspace panel's contents for one project: tabs for the folder's git changes (in a
 * repository only), its files and any terminals, and a picker for which of the project's
 * folders they show. Terminals keep the folder they started in.
 */
export function WorkspacePanel({
  projectId,
  folders,
  open,
}: {
  projectId: number
  folders: string[]
  /** The panel shows: a terminal counts as active only then. */
  open: boolean
}) {
  const [picked, setPicked] = useState(folders[0])
  // A folder removed in Project settings falls back to the first.
  const folder = folders.includes(picked) ? picked : folders[0]
  const version = useFolderVersion(projectId, folder)
  const info = useReading(`info ${folder}`, version, () =>
    folderInfo(projectId, folder)
  )
  const changes = useReading(`changes ${folder}`, version, () =>
    folderChanges(projectId, folder)
  )
  const repo = info.data?.repo ?? false

  const [terminals, setTerminals] = useState<TerminalTab[]>([])
  const [nextTerminal, setNextTerminal] = useState(1)
  const [chosenTab, setChosenTab] = useState<string | null>(null)
  const tabs = [
    ...(repo ? ["changes"] : []),
    "files",
    ...terminals.map((t) => `terminal-${t.id}`),
  ]
  const tab =
    chosenTab && tabs.includes(chosenTab) ? chosenTab : (tabs[0] ?? "files")

  function addTerminal() {
    const id = nextTerminal
    setNextTerminal(id + 1)
    setTerminals((current) => [...current, { id, folder, title: null }])
    setChosenTab(`terminal-${id}`)
  }

  function closeTerminal(closing: TerminalTab) {
    const index = terminals.indexOf(closing)
    const rest = terminals.filter((t) => t !== closing)
    setTerminals(rest)
    if (tab === `terminal-${closing.id}`) {
      const neighbour = rest[Math.min(index, rest.length - 1)]
      setChosenTab(neighbour ? `terminal-${neighbour.id}` : null)
    }
  }

  function setTitle(id: number, title: string) {
    setTerminals((current) =>
      current.map((t) => (t.id === id ? { ...t, title: title || null } : t))
    )
  }

  const fileCount = changes.data?.files.length ?? 0
  const failed = info.error ?? changes.error

  return (
    <Tabs
      value={tab}
      onValueChange={setChosenTab}
      className="relative flex h-full min-w-80 flex-col gap-0 bg-background"
    >
      <div
        data-tauri-drag-region
        className="flex h-titlebar shrink-0 items-center gap-2 border-b px-2"
      >
        <TabsPrimitive.List
          aria-label="Workspace"
          className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto"
        >
          {repo && (
            <PanelTab value="changes">
              Changes
              {fileCount > 0 && (
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {fileCount}
                </span>
              )}
            </PanelTab>
          )}
          <PanelTab value="files">Files</PanelTab>
          {terminals.length > 0 && (
            <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
          )}
          {terminals.map((terminal) => (
            <PanelTab
              key={terminal.id}
              value={`terminal-${terminal.id}`}
              onClose={() => closeTerminal(terminal)}
              closeLabel={`Close ${terminal.title ?? `Terminal ${terminal.id}`}`}
            >
              <span className="max-w-32 truncate">
                {terminal.title ?? `Terminal ${terminal.id}`}
              </span>
            </PanelTab>
          ))}
        </TabsPrimitive.List>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="New terminal"
              onClick={addTerminal}
              className="shrink-0 rounded-md text-muted-foreground hover:text-foreground"
            >
              <Plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New terminal</TooltipContent>
        </Tooltip>
        {folders.length > 1 && (
          <Select value={folder} onValueChange={setPicked}>
            <SelectTrigger
              size="sm"
              aria-label="Folder"
              className="ml-auto h-7 max-w-40 min-w-0 rounded-md border-transparent bg-transparent pr-1.5 pl-2 font-mono text-xs text-muted-foreground shadow-none hover:bg-accent hover:text-foreground dark:bg-transparent dark:hover:bg-accent"
            >
              <Folder className="size-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              {folders.map((f) => (
                <SelectItem key={f} value={f} className="font-mono text-xs">
                  {folderName(f)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {failed ? (
        <ErrorCard message={failed} className="m-auto max-w-xs" />
      ) : (
        <>
          {repo && (
            <TabsContent value="changes" forceMount className={PANE}>
              {changes.data && (
                <ChangesView
                  changes={changes.data}
                  branch={info.data?.branch ?? null}
                />
              )}
            </TabsContent>
          )}
          <TabsContent value="files" forceMount className={PANE}>
            <FilesView
              key={folder}
              projectId={projectId}
              folder={folder}
              version={version}
              statuses={treeStatuses(changes.data)}
            />
          </TabsContent>
        </>
      )}
      {terminals.map((terminal) => (
        <TabsContent
          key={terminal.id}
          value={`terminal-${terminal.id}`}
          forceMount
          className={TERMINAL_PANE}
        >
          <TerminalView
            projectId={projectId}
            folder={terminal.folder}
            active={open && tab === `terminal-${terminal.id}`}
            onTitle={(title) => setTitle(terminal.id, title)}
          />
        </TabsContent>
      ))}
    </Tabs>
  )
}

/** Every tab's pane fills the panel; inactive ones stay mounted, hidden. */
const PANE = "min-h-0 flex-1 data-[state=inactive]:hidden"

/**
 * A terminal's pane keeps its size while another tab shows: it lies over the panel's body
 * (the panel lays out the open pane, so its body has a size) and is only made invisible.
 * Taken out of the layout, it would measure 0 wide and the terminal would refit to one
 * column, rewrapping everything in it and telling the shell so.
 */
const TERMINAL_PANE =
  "absolute inset-x-0 bottom-0 top-titlebar data-[state=inactive]:pointer-events-none data-[state=inactive]:invisible"

/**
 * One of the panel's tabs, on the brand's quiet controls (Paper "12 Components"): 28 px
 * on the 40 px title bar row, 14 px medium in every state so nothing shifts, muted until
 * hovered or open, the open one on the accent grey like a selected sidebar row. Keyboard
 * focus shows as that grey too, not a ring: WebKit counts focus that follows typing in a
 * terminal as keyboard focus, so a ring lit up on plain clicks. A closable tab keeps room
 * for its × at all times; the × shows on hover and on the open tab.
 */
function PanelTab({
  value,
  children,
  onClose,
  closeLabel,
}: {
  value: string
  children: React.ReactNode
  onClose?: () => void
  closeLabel?: string
}) {
  return (
    <div className="group/tab relative flex shrink-0 items-center">
      <TabsPrimitive.Trigger
        value={value}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none select-none hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground data-[state=active]:bg-accent data-[state=active]:text-foreground",
          onClose && "pr-7"
        )}
      >
        {children}
      </TabsPrimitive.Trigger>
      {onClose && (
        <button
          type="button"
          aria-label={closeLabel}
          onClick={onClose}
          className="absolute right-1.5 flex size-4 items-center justify-center text-muted-foreground opacity-0 outline-none group-hover/tab:opacity-100 group-has-data-[state=active]/tab:opacity-100 hover:text-foreground focus-visible:text-foreground focus-visible:opacity-100"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  )
}
