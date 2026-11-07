import { Folder, Plus, X } from "lucide-react"
import { Tabs as TabsPrimitive } from "radix-ui"
import { lazy, Suspense, useState } from "react"

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
import type { ExtraTab } from "./extra-tab"
import { treeStatuses } from "./status"
import { useFolderVersion, useReading } from "./use-folder"

// Each tab's code loads the first time it shows: Pierre's diffs with Shiki for Changes and
// Files, the terminal (wterm and its Ghostty core) for terminals. The panel itself is light.
const ChangesView = lazy(() =>
  import("./changes-view").then((m) => ({ default: m.ChangesView }))
)
const FilesView = lazy(() =>
  import("./files-view").then((m) => ({ default: m.FilesView }))
)
const TerminalView = lazy(() =>
  import("./terminal-view").then((m) => ({ default: m.TerminalView }))
)

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
 * repository only), its files, the extensions' tabs (`tabs`, such as To-dos) and any
 * terminals, and a picker for which of the project's folders they show. Terminals keep the
 * folder they started in. A project without folders has only the extensions' tabs. Which
 * tab is chosen is the layout's, so its header can open the panel on one.
 */
export function WorkspacePanel({
  projectId,
  folders,
  tabs: extraTabs,
  open,
  chosenTab,
  onChooseTab,
}: {
  projectId: number
  folders: string[]
  tabs: ExtraTab[]
  /** The panel shows: a terminal counts as active only then. */
  open: boolean
  chosenTab: string | null
  onChooseTab: (tab: string | null) => void
}) {
  const [picked, setPicked] = useState(folders[0])
  // A folder removed in Project settings falls back to the first; none without folders.
  const folder: string | undefined = folders.includes(picked)
    ? picked
    : folders[0]
  const version = useFolderVersion(projectId, folder)
  // Cheap: whether the folder is in a repository, and its branch.
  const info = useReading(
    `info ${folder}`,
    version,
    () => folderInfo(projectId, folder ?? ""),
    folder !== undefined
  )
  const repo = info.data?.repo ?? false
  // The tabs that have shown: each mounts the first time it does and stays, hidden.
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set())
  // The diff of every changed file, for Changes and the file tree's marks: read only once
  // one of them has shown.
  const changes = useReading(
    `changes ${folder}`,
    version,
    () => folderChanges(projectId, folder ?? ""),
    folder !== undefined && (shown.has("changes") || shown.has("files"))
  )

  const [terminals, setTerminals] = useState<TerminalTab[]>([])
  const [nextTerminal, setNextTerminal] = useState(1)
  const tabs = [
    ...(repo ? ["changes"] : []),
    ...(folder === undefined ? [] : ["files"]),
    ...extraTabs.map((t) => t.id),
    ...terminals.map((t) => `terminal-${t.id}`),
  ]
  const tab =
    chosenTab && tabs.includes(chosenTab) ? chosenTab : (tabs[0] ?? "files")
  // Counted once the panel shows and knows its tabs (Changes only in a repository), so the
  // tab it opens on before that never loads.
  const settled =
    open &&
    (folder === undefined || info.data !== undefined || info.error !== null)
  if (settled && !shown.has(tab)) setShown(new Set(shown).add(tab))

  function addTerminal() {
    if (folder === undefined) return
    const id = nextTerminal
    setNextTerminal(id + 1)
    setTerminals((current) => [...current, { id, folder, title: null }])
    onChooseTab(`terminal-${id}`)
  }

  function closeTerminal(closing: TerminalTab) {
    const index = terminals.indexOf(closing)
    const rest = terminals.filter((t) => t !== closing)
    setTerminals(rest)
    if (tab === `terminal-${closing.id}`) {
      const neighbour = rest[Math.min(index, rest.length - 1)]
      onChooseTab(neighbour ? `terminal-${neighbour.id}` : null)
    }
  }

  function setTitle(id: number, title: string) {
    setTerminals((current) =>
      current.map((t) => (t.id === id ? { ...t, title: title || null } : t))
    )
  }

  const fileCount = changes.data?.files.length ?? 0
  // A folder that can't be read fails its own tabs, not the extensions'.
  const failed = info.error ?? changes.error
  const folderTab = tab === "changes" || tab === "files"

  return (
    <Tabs
      value={tab}
      onValueChange={onChooseTab}
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
          {folder !== undefined && <PanelTab value="files">Files</PanelTab>}
          {extraTabs.map((extra) => (
            <PanelTab key={extra.id} value={extra.id}>
              {extra.label}
              {extra.count !== undefined && extra.count > 0 && (
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {extra.count}
                </span>
              )}
            </PanelTab>
          ))}
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
        {folder !== undefined && (
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
        )}
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

      {failed
        ? folderTab && (
            <ErrorCard message={failed} className="m-auto max-w-xs" />
          )
        : folder !== undefined && (
            <>
              {repo && shown.has("changes") && (
                <TabsContent value="changes" forceMount className={PANE}>
                  {changes.data && (
                    <Suspense>
                      <ChangesView
                        changes={changes.data}
                        branch={info.data?.branch ?? null}
                      />
                    </Suspense>
                  )}
                </TabsContent>
              )}
              {shown.has("files") && (
                <TabsContent value="files" forceMount className={PANE}>
                  <Suspense>
                    <FilesView
                      key={folder}
                      projectId={projectId}
                      folder={folder}
                      version={version}
                      statuses={treeStatuses(changes.data)}
                    />
                  </Suspense>
                </TabsContent>
              )}
            </>
          )}
      {extraTabs.map(
        (extra) =>
          shown.has(extra.id) && (
            <TabsContent
              key={extra.id}
              value={extra.id}
              forceMount
              className={PANE}
            >
              {extra.content}
            </TabsContent>
          )
      )}
      {terminals.map((terminal) => (
        <TabsContent
          key={terminal.id}
          value={`terminal-${terminal.id}`}
          forceMount
          className={TERMINAL_PANE}
        >
          <Suspense>
            <TerminalView
              projectId={projectId}
              folder={terminal.folder}
              active={open && tab === `terminal-${terminal.id}`}
              onTitle={(title) => setTitle(terminal.id, title)}
            />
          </Suspense>
        </TabsContent>
      ))}
    </Tabs>
  )
}

/** Every tab's pane fills the panel; once shown, an inactive one stays mounted, hidden. */
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
