import { Folder, Maximize2, Minimize2, Plus, X } from "lucide-react"
import {
  type CSSProperties,
  Fragment,
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react"

import { ErrorCard } from "@/components/error-card"
import { showErrorToast } from "@/components/error-toast"
import { Button } from "@/components/ui/button"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { folderName } from "@/lib/text"
import { cn } from "@/lib/utils"

import type { Changes, FolderInfo } from "./api"
import type { ExtraTab } from "./extra-tab"
import { failureOf } from "./readings"
import type { Section } from "./sections"
import { treeStatuses } from "./status"
import type { Reading } from "./use-folder"

// Each panel's code loads the first time it shows: Pierre's diffs with Shiki for Changes and
// Files, the terminal (wterm and its Ghostty core) for Terminal.
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

/** The least height an open panel can be dragged to: its header and a few lines. */
const MIN_PANEL_HEIGHT = 120

/**
 * The column's panels (`workspace-layout.tsx` decides which are open): the open ones, in
 * order, in one vertical resizable group, as in the Claude app, dragged taller or shorter
 * at the handles between them. A closed panel leaves the group; Changes, Files and To-dos
 * read again from the cache when they come back. The terminals live in one layer laid over
 * Terminal's body instead, so they never restart: closed, it keeps its last place and size,
 * out of sight. Terminal holds the terminals, each in the folder it started in; it opens
 * with one, and closing the last closes the panel.
 */
export function WorkspaceColumn({
  projectId,
  folders,
  folder,
  onFolder,
  version,
  info,
  changes,
  tabs,
  sections,
  mounted,
  showing,
  shown,
  maximized,
  onMaximize,
  onClose,
}: {
  projectId: number
  folders: string[]
  /** The folder Changes and Files show, and new terminals start in; none without folders. */
  folder: string | undefined
  onFolder: (folder: string) => void
  version: number
  info: Reading<FolderInfo>
  changes: Reading<Changes | null>
  tabs: ExtraTab[]
  sections: Section[]
  mounted: ReadonlySet<string>
  /** The panels open, in order. */
  showing: string[]
  /** Whether the column shows: hidden, its panels stay open but out of sight. */
  shown: boolean
  maximized: string | null
  onMaximize: (id: string) => void
  onClose: (id: string) => void
}) {
  const [terminals, setTerminals] = useState<TerminalTab[]>([])
  const [nextTerminal, setNextTerminal] = useState(1)
  const [chosen, setChosen] = useState<number | null>(null)
  const current =
    terminals.find((t) => t.id === chosen) ?? terminals.at(-1) ?? null

  // The one taking the whole column, while it's open.
  const whole = maximized !== null && showing.includes(maximized)
  const visible = (id: string) =>
    showing.includes(id) && (!whole || maximized === id)

  function addTerminal() {
    if (folder === undefined) return
    const id = nextTerminal
    setNextTerminal(id + 1)
    setTerminals([...terminals, { id, folder, title: null }])
    setChosen(id)
  }

  // Terminal opens with a terminal in it.
  if (visible("terminal") && terminals.length === 0 && folder !== undefined)
    addTerminal()

  function closeTerminal(closing: TerminalTab) {
    const rest = terminals.filter((t) => t !== closing)
    setTerminals(rest)
    if (rest.length === 0) onClose("terminal")
  }

  function setTitle(id: number, title: string) {
    setTerminals((now) =>
      now.map((t) => (t.id === id ? { ...t, title: title || null } : t))
    )
  }

  // A failed read with nothing read before it fills Changes and Files with its error. Once
  // they have shown something, they keep showing it, and a toast says the latest read
  // failed (once per error, while one of them is in sight).
  const { blocking: failed, stale } = failureOf(info, changes)
  const staleInSight =
    shown && (visible("changes") || visible("files")) ? stale : null
  useEffect(() => {
    if (staleInSight) showErrorToast(staleInSight)
  }, [staleInSight])
  const folderPicker = folders.length > 1 && folder !== undefined && (
    <FolderPicker folders={folders} folder={folder} onFolder={onFolder} />
  )

  function content(section: Section): {
    actions?: ReactNode
    body: ReactNode
    /** Whether its header shows its name: not over Terminal's own tabs. */
    named?: boolean
  } {
    switch (section.id) {
      case "changes":
        return {
          actions: folderPicker,
          body: failed ? (
            <ErrorCard message={failed} className="m-auto max-w-xs" />
          ) : (
            changes.data && (
              <Suspense>
                <ChangesView
                  changes={changes.data}
                  branch={info.data?.branch ?? null}
                />
              </Suspense>
            )
          ),
        }
      case "files":
        return {
          actions: folderPicker,
          body:
            failed || folder === undefined ? (
              failed && (
                <ErrorCard message={failed} className="m-auto max-w-xs" />
              )
            ) : (
              <Suspense>
                <FilesView
                  key={folder}
                  projectId={projectId}
                  folder={folder}
                  version={version}
                  statuses={treeStatuses(changes.data)}
                />
              </Suspense>
            ),
        }
      case "terminal":
        return {
          named: terminals.length < 2,
          actions: (
            <>
              <TerminalTabs
                terminals={terminals}
                current={current}
                onChoose={(t) => setChosen(t.id)}
                onClose={closeTerminal}
                onAdd={addTerminal}
              />
              {/* Where the next terminal starts. */}
              {folderPicker}
            </>
          ),
          body: <div ref={terminalSlot} className="min-h-0 flex-1" />,
        }
      default:
        return { body: tabs.find((t) => t.id === section.id)?.content }
    }
  }

  const several = showing.length > 1
  const open = sections.filter((section) => visible(section.id))
  const terminalOpen = open.some((section) => section.id === "terminal")

  // Where Terminal's body is in the column, for the terminals' layer: measured whenever
  // the column or any of its panels changes size. Closed, the layer keeps its last place.
  const root = useRef<HTMLDivElement>(null)
  const terminalSlot = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<CSSProperties | null>(null)
  const layout = open.map((section) => section.id).join(" ")
  useEffect(() => {
    const column = root.current
    const slot = terminalSlot.current
    if (!column || !slot) return
    function measure() {
      if (!column || !slot) return
      const outer = column.getBoundingClientRect()
      const inner = slot.getBoundingClientRect()
      if (inner.width < 1 || inner.height < 1) return
      setPlace({
        top: inner.top - outer.top,
        left: inner.left - outer.left,
        width: inner.width,
        height: inner.height,
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(column)
    for (const panel of column.querySelectorAll("[data-panel]"))
      observer.observe(panel)
    return () => observer.disconnect()
  }, [layout])

  return (
    <div ref={root} className="relative h-full min-w-80 bg-background">
      <ResizablePanelGroup orientation="vertical" className="h-full">
        {open.map((section, index) => {
          const { actions, body, named = true } = content(section)
          return (
            <Fragment key={section.id}>
              {index > 0 && (
                <ResizableHandle className="hover:bg-ring/40 data-[separator=active]:bg-ring/60" />
              )}
              <ResizablePanel
                id={section.id}
                minSize={MIN_PANEL_HEIGHT}
                style={{ overflow: "hidden" }}
              >
                <PanelFrame
                  section={section}
                  named={named}
                  actions={actions}
                  maximized={whole && maximized === section.id}
                  canMaximize={several}
                  onMaximize={() => onMaximize(section.id)}
                  onClose={() => onClose(section.id)}
                >
                  {body}
                </PanelFrame>
              </ResizablePanel>
            </Fragment>
          )
        })}
      </ResizablePanelGroup>
      {mounted.has("terminal") && place && (
        <div
          inert={!(shown && terminalOpen)}
          className={cn(
            "absolute",
            !(shown && terminalOpen) && "pointer-events-none invisible"
          )}
          style={place}
        >
          {terminals.map((terminal) => (
            <div
              key={terminal.id}
              className={cn(
                // Laid out and only made invisible while another shows: taken out of
                // the layout, it would measure 0 wide and refit to one column.
                "absolute inset-0",
                terminal !== current && "pointer-events-none invisible"
              )}
            >
              <Suspense>
                <TerminalView
                  projectId={projectId}
                  folder={terminal.folder}
                  active={shown && terminalOpen && terminal === current}
                  onTitle={(title) => setTitle(terminal.id, title)}
                />
              </Suspense>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One panel: its header (its name and count, its own actions, expand and close) over its
 * body.
 */
function PanelFrame({
  section,
  named,
  actions,
  maximized,
  canMaximize,
  onMaximize,
  onClose,
  children,
}: {
  section: Section
  named: boolean
  actions?: ReactNode
  maximized: boolean
  canMaximize: boolean
  onMaximize: () => void
  onClose: () => void
  children: ReactNode
}) {
  return (
    <section
      aria-label={section.label}
      className="flex h-full min-h-0 flex-col overflow-hidden"
    >
      <div
        data-tauri-drag-region
        className="flex h-titlebar shrink-0 items-center gap-1 border-b pr-2 pl-3"
      >
        {named && (
          <h2 className="pointer-events-none shrink-0 text-sm font-medium">
            {section.label}
          </h2>
        )}
        {named && section.count !== undefined && section.count > 0 && (
          <span className="pointer-events-none font-mono text-xs text-muted-foreground tabular-nums">
            {section.count}
          </span>
        )}
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1",
            named ? "pl-1" : "-ml-1"
          )}
        >
          {actions}
        </div>
        {(canMaximize || maximized) && (
          <HeaderButton
            label={maximized ? "Restore" : "Expand"}
            onClick={onMaximize}
          >
            {maximized ? <Minimize2 /> : <Maximize2 />}
          </HeaderButton>
        )}
        <HeaderButton
          label={`Close ${section.label.toLowerCase()}`}
          onClick={onClose}
        >
          <X />
        </HeaderButton>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  )
}

function HeaderButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
          className="shrink-0 rounded-md text-muted-foreground hover:text-foreground"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The terminals, as quiet tabs in Terminal's header (14 px medium in every state, the
 * chosen one on the accent grey; its × on hover and on the chosen one), then +. They look
 * like tabs but are buttons, the chosen one pressed: the terminals live in a layer of
 * their own, not in panels these could control, and each has a close button beside it.
 */
function TerminalTabs({
  terminals,
  current,
  onChoose,
  onClose,
  onAdd,
}: {
  terminals: TerminalTab[]
  current: TerminalTab | null
  onChoose: (terminal: TerminalTab) => void
  onClose: (terminal: TerminalTab) => void
  onAdd: () => void
}) {
  const several = terminals.length > 1
  return (
    <>
      {/* Always there, empty with one terminal, so the header keeps its spacing. */}
      <div
        role={several ? "group" : undefined}
        aria-label={several ? "Terminals" : undefined}
        className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto"
      >
        {several &&
          terminals.map((terminal) => {
            const name = terminal.title ?? `Terminal ${terminal.id}`
            const chosen = terminal === current
            return (
              <div
                key={terminal.id}
                className="group/tab relative flex shrink-0 items-center"
              >
                <button
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => onChoose(terminal)}
                  className={cn(
                    "flex h-7 items-center rounded-md pr-7 pl-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none select-none hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground",
                    chosen && "bg-accent text-foreground"
                  )}
                >
                  <span className="max-w-32 truncate">{name}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Close ${name}`}
                  onClick={() => onClose(terminal)}
                  className={cn(
                    "absolute right-1.5 flex size-4 items-center justify-center text-muted-foreground opacity-0 outline-none group-hover/tab:opacity-100 hover:text-foreground focus-visible:text-foreground focus-visible:opacity-100",
                    chosen && "opacity-100"
                  )}
                >
                  <X className="size-3" />
                </button>
              </div>
            )
          })}
      </div>
      <HeaderButton label="New terminal" onClick={onAdd}>
        <Plus />
      </HeaderButton>
    </>
  )
}

/** Which of the project's folders Changes and Files show, and new terminals start in. */
function FolderPicker({
  folders,
  folder,
  onFolder,
}: {
  folders: string[]
  folder: string
  onFolder: (folder: string) => void
}) {
  return (
    <Select value={folder} onValueChange={onFolder}>
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
  )
}
