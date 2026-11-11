import {
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { useDefaultLayout, usePanelRef } from "react-resizable-panels"

import { ShortcutKeys } from "@/components/shortcut-keys"
import { Button } from "@/components/ui/button"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { commandShortcut } from "@/lib/shortcuts"
import { cn } from "@/lib/utils"

import { folderChanges, folderInfo } from "./api"
import type { ExtraTab } from "./extra-tab"
import { panelRequest, projectPanels } from "./panel-requests"
import { folderSections, type Section } from "./sections"
import { useFolderVersion, useReading } from "./use-folder"

// The panels' code (Pierre's diffs with Shiki, the terminal) loads the first time one
// opens, not with the window; each panel's own the first time it shows
// (workspace-column.tsx).
const WorkspaceColumn = lazy(() =>
  import("./workspace-column").then((m) => ({ default: m.WorkspaceColumn }))
)

/** Shows or hides the Terminal panel. */
const TERMINAL_SHORTCUT = commandShortcut("j")

/** The column's width when it first opens, and the least it can be dragged to. */
const OPEN_SIZE = "42%"
const MIN_SIZE = 320

/**
 * A project's page with its panels in a column on the right, as in the Claude app (owner,
 * 2026-11-08): Changes, Files and Terminal for a project with folders (Changes says so
 * when the folder chosen isn't in a git repository), and each extension's (`tabs`, such as To-dos). Each has a toggle in the header
 * and opens on its own, with its own header; several open stack in the column, which shows
 * while any is open and is dragged wider or narrower at its edge. A panel mounts the first
 * time it opens and stays while it's closed, so terminals keep running, at their size and
 * out of the keyboard's reach; the column's width is kept on this Mac. `header` gets the
 * toggles to put in the page's header. The command palette sees the panels there are and
 * asks to show one through `panel-requests.ts`.
 */
export function WorkspaceLayout({
  project,
  tabs = [],
  header,
  children,
}: {
  project: { id: number; folders: string[] }
  tabs?: ExtraTab[]
  header: (toggles: ReactNode) => ReactNode
  children: ReactNode
}) {
  const column = usePanelRef()
  const contents = useRef<HTMLDivElement>(null)
  // The panels the user opened, closed only by them, and the one taking the whole column.
  // A panel asked for before this page opened (`panelRequest`) starts open.
  const [requested] = useState(() => {
    const request = panelRequest.get()
    return request?.projectId === project.id ? request.id : null
  })
  const [open, setOpen] = useState<string[]>(requested ? [requested] : [])
  const [maximized, setMaximized] = useState<string | null>(null)
  // Every panel that has opened: each mounts the first time and stays.
  const [mounted, setMounted] = useState<ReadonlySet<string>>(
    () => new Set(requested ? [requested] : [])
  )
  useEffect(() => {
    if (requested) panelRequest.set(null)
  }, [requested])
  // The column's width when it was last shown, which its contents keep while it's hidden.
  const [width, setWidth] = useState(0)
  const [shown, setShown] = useState(false)

  const [picked, setPicked] = useState(project.folders[0])
  // A folder removed in Project settings falls back to the first; none without folders.
  const folder: string | undefined = project.folders.includes(picked)
    ? picked
    : project.folders[0]
  const folderPanels =
    mounted.has("changes") || mounted.has("files") || mounted.has("terminal")
  // The folder is watched once a panel that shows it has opened.
  const version = useFolderVersion(
    project.id,
    folderPanels ? folder : undefined
  )
  // Cheap: whether the folder is in a repository, and its branch.
  const info = useReading(
    `info ${folder}`,
    version,
    () => folderInfo(project.id, folder ?? ""),
    folder !== undefined
  )
  const repo = info.data?.repo
  // The diff of every changed file, for Changes and the file tree's marks: read only once
  // one of them has opened, and only in a repository, the only place it can have any.
  const changes = useReading(
    `changes ${folder}`,
    version,
    () => folderChanges(project.id, folder ?? ""),
    folder !== undefined &&
      repo === true &&
      (mounted.has("changes") || mounted.has("files"))
  )

  const sections: Section[] = [
    ...folderSections({
      folder,
      repo,
      changes: changes.data?.files.length,
      terminalShortcut: TERMINAL_SHORTCUT,
    }),
    ...tabs.map(({ id, label, icon, count, keywords }) => ({
      id,
      label,
      icon,
      count,
      keywords,
    })),
  ]
  const available = sections.length > 0
  const ids = sections.map((s) => s.id)
  // The open panels there are, stacked in the header's order. One no longer there (an
  // extension turned off, Agents off the call's page) drops out but stays in `open`,
  // whatever else is toggled meanwhile, so it comes back open if it was. Not expanded,
  // though: back, on the next call say, it would hide the panels beside it unasked.
  const showing = ids.filter((id) => open.includes(id))
  if (maximized !== null && !ids.includes(maximized)) setMaximized(null)

  // One saved layout with the column and one without, as the library needs when a panel
  // comes and goes.
  const layout = useDefaultLayout({
    id: "workspace",
    panelIds: available ? ["page", "workspace"] : ["page"],
    storage: localStorage,
  })

  // The column shows while a panel is open. Imperative: the library owns its size.
  const anyOpen = showing.length > 0
  useEffect(() => {
    const handle = column.current
    if (!handle) return
    if (!anyOpen) {
      if (!handle.isCollapsed()) handle.collapse()
      return
    }
    if (handle.isCollapsed()) {
      handle.expand()
      // Never shown on this Mac: expand() knows no earlier width.
      if (handle.getSize().inPixels < MIN_SIZE) handle.resize(OPEN_SIZE)
    }
  }, [column, anyOpen])

  /** Opens the panel `id` in its place among the others, or closes it. */
  function toggle(id: string) {
    setMaximized(null)
    if (showing.includes(id)) {
      setOpen(open.filter((s) => s !== id))
      return
    }
    setMounted(new Set(mounted).add(id))
    setOpen([...open, id])
  }

  /** Brings the panel `id` into view, never closing it: for the command palette. */
  function show(id: string) {
    if (!showing.includes(id)) toggle(id)
    else if (maximized !== null && maximized !== id) setMaximized(null)
  }

  // The palette lists this page's panels and shows one from its own click, through the
  // latest `show`; the list changes with the panels' ids, not every render.
  const latestShow = useRef(show)
  useLayoutEffect(() => {
    latestShow.current = show
  })
  const panelIds = ids.join(" ")
  const publish = useEffectEvent(() =>
    projectPanels.set({
      projectId: project.id,
      sections,
      show: (id) => latestShow.current(id),
    })
  )
  useEffect(() => {
    publish()
    return () => projectPanels.set(null)
  }, [panelIds])

  const onShortcut = useEffectEvent(() => toggle("terminal"))
  const hasTerminal = ids.includes("terminal")
  useEffect(() => {
    if (!hasTerminal) return
    function onKeyDown(event: KeyboardEvent) {
      if (!TERMINAL_SHORTCUT.matches(event)) return
      event.preventDefault()
      onShortcut()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [hasTerminal])

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
      className="min-h-0 flex-1"
    >
      <ResizablePanel id="page" minSize={360} className="flex flex-col">
        {header(
          available && (
            <div className="flex items-center gap-0.5">
              {sections.map((section) => (
                <PanelToggle
                  key={section.id}
                  section={section}
                  pressed={shown && showing.includes(section.id)}
                  onClick={() => toggle(section.id)}
                />
              ))}
            </div>
          )
        )}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </ResizablePanel>
      {available && (
        <>
          <ResizableHandle
            // With no panel open there's nothing to show: the library hit-tests a handle
            // itself, so hiding it isn't enough to keep it from dragging an empty column open.
            disabled={!anyOpen}
            disableDoubleClick
            className={cn(
              "transition-opacity hover:bg-ring/40 data-[separator=active]:bg-ring/60",
              !(shown && anyOpen) && "pointer-events-none opacity-0"
            )}
          />
          <ResizablePanel
            id="workspace"
            panelRef={column}
            collapsible
            defaultSize={0}
            minSize={MIN_SIZE}
            maxSize="75%"
            groupResizeBehavior="preserve-pixel-size"
            // Clipped, not squeezed: while hidden, the contents keep the width they had,
            // so a terminal never refits (and rewraps) just because it's hidden.
            style={{ overflow: "hidden" }}
            onResize={(size) => {
              const now = size.inPixels > 0
              if (now) setWidth(size.inPixels)
              else {
                // Hidden with focus inside: typing must not go on into what can't be seen.
                if (
                  contents.current?.contains(document.activeElement) &&
                  document.activeElement instanceof HTMLElement
                )
                  document.activeElement.blur()
                // Dragged shut: every panel there closes.
                if (anyOpen) setOpen(open.filter((id) => !ids.includes(id)))
              }
              setShown(now)
            }}
          >
            {/* Hidden, the contents are inert: out of reach of the keyboard and the
                pointer, and of focus. */}
            <div
              ref={contents}
              inert={!shown}
              className="h-full"
              style={shown ? undefined : { width }}
            >
              {mounted.size > 0 && (
                <Suspense>
                  <WorkspaceColumn
                    projectId={project.id}
                    folders={project.folders}
                    folder={folder}
                    onFolder={setPicked}
                    version={version}
                    info={info}
                    changes={changes}
                    tabs={tabs}
                    sections={sections}
                    mounted={mounted}
                    showing={showing}
                    shown={shown}
                    maximized={maximized}
                    onMaximize={(id) =>
                      setMaximized(maximized === id ? null : id)
                    }
                    onClose={toggle}
                  />
                </Suspense>
              )}
            </div>
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  )
}

/** A panel's toggle in the header: its icon and count, pressed while it shows. */
function PanelToggle({
  section,
  pressed,
  onClick,
}: {
  section: Section
  pressed: boolean
  onClick: () => void
}) {
  const label = pressed ? `Hide ${section.label.toLowerCase()}` : section.label
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className={cn(
            "h-8 min-w-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground",
            pressed && "bg-accent text-foreground"
          )}
        >
          {section.icon}
          {section.count !== undefined && section.count > 0 && (
            <span className="font-mono text-xs tabular-nums">
              {section.count}
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {section.shortcut && <ShortcutKeys shortcut={section.shortcut} />}
      </TooltipContent>
    </Tooltip>
  )
}
