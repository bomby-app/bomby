import type { GhosttyCore } from "@wterm/ghostty"
import { FolderGit2, Plus, X } from "lucide-react"
import { Suspense, useState } from "react"

import { ErrorCard } from "@/components/error-card"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { folderChanges, folderInfo } from "./api"
import { ChangesView } from "./changes-view"
import { FilesView } from "./files-view"
import { loadTerminalCore, TerminalView } from "./terminal-view"
import { useFolderVersion, useReading } from "./use-folder"

type TerminalTab = {
  id: number
  folder: string
  /** What the shell last called itself (OSC 0/2), if anything. */
  title: string | null
  core: Promise<GhosttyCore>
}

/** Long enough for a closed terminal to unmount before its emulator goes. */
const DISPOSE_DELAY_MS = 1000

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
}: {
  projectId: number
  folders: string[]
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
    setTerminals((current) => [
      ...current,
      { id, folder, title: null, core: loadTerminalCore() },
    ])
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
    // The emulator's WASM memory goes once its terminal has unmounted (WTerm.destroy()
    // leaves a core it was given alone).
    setTimeout(() => {
      void closing.core.then((core) => core.dispose())
    }, DISPOSE_DELAY_MS)
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
      className="flex h-full min-w-0 flex-col gap-0 bg-background"
    >
      <div
        data-tauri-drag-region
        className="flex h-titlebar shrink-0 items-center gap-1 border-b pr-2 pl-2"
      >
        <TabsList
          variant="line"
          className="no-scrollbar h-full min-w-0 justify-start gap-0.5 overflow-x-auto p-0"
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
          {terminals.map((terminal) => (
            <PanelTab
              key={terminal.id}
              value={`terminal-${terminal.id}`}
              onClose={() => closeTerminal(terminal)}
              closeLabel="Close the terminal"
            >
              <span className="max-w-32 truncate">
                {terminal.title ?? `Terminal ${terminal.id}`}
              </span>
            </PanelTab>
          ))}
        </TabsList>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="New terminal"
              onClick={addTerminal}
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
              className="ml-auto max-w-40 min-w-0 border-transparent font-mono text-xs shadow-none hover:bg-accent dark:bg-transparent"
            >
              <FolderGit2 className="text-muted-foreground" />
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
            />
          </TabsContent>
        </>
      )}
      {terminals.map((terminal) => (
        <TabsContent
          key={terminal.id}
          value={`terminal-${terminal.id}`}
          forceMount
          className={cn(PANE, "bomby-terminal-pane")}
        >
          <Suspense>
            <TerminalView
              projectId={projectId}
              folder={terminal.folder}
              core={terminal.core}
              active={tab === `terminal-${terminal.id}`}
              onTitle={(title) => setTitle(terminal.id, title)}
            />
          </Suspense>
        </TabsContent>
      ))}
    </Tabs>
  )
}

/** Every tab's pane fills the panel; inactive ones stay mounted, hidden. */
const PANE = "min-h-0 flex-1 data-[state=inactive]:hidden"

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
    <div className="group/tab relative flex h-7 shrink-0 items-center">
      <TabsTrigger
        value={value}
        className={cn(
          "h-7 flex-none rounded-md px-2.5 text-sm font-normal text-muted-foreground after:hidden hover:bg-accent hover:text-foreground data-active:bg-accent! data-active:font-medium data-active:text-foreground",
          onClose && "pr-7"
        )}
      >
        {children}
      </TabsTrigger>
      {onClose && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={closeLabel}
          onClick={onClose}
          className="absolute right-1 size-5 text-muted-foreground opacity-0 group-hover/tab:opacity-100 group-has-data-active/tab:opacity-100 hover:bg-transparent hover:text-foreground focus-visible:opacity-100"
        >
          <X />
        </Button>
      )}
    </div>
  )
}
