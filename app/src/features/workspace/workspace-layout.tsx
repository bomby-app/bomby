import { PanelRightClose, PanelRightOpen } from "lucide-react"
import {
  lazy,
  type ReactNode,
  type Ref,
  Suspense,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react"
import { useDefaultLayout, usePanelRef } from "react-resizable-panels"

import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
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

import type { ExtraTab } from "./extra-tab"

// The panel's libraries (Pierre's diffs with Shiki, the terminal) load the first time it
// opens, not with the window.
const WorkspacePanel = lazy(() =>
  import("./workspace-panel").then((m) => ({ default: m.WorkspacePanel }))
)

export const WORKSPACE_SHORTCUT = commandShortcut("j")

/** The panel's width when it first opens, and the least it can be dragged to. */
const OPEN_SIZE = "42%"
const MIN_SIZE = 320

/**
 * A project's page with the workspace panel on its right, as in other desktop agents:
 * dragged wider or narrower at its edge, opened and closed from the header (⌘J). A project
 * has one when it has folders or an extension's tab (`tabs`, such as To-dos); each of those
 * gets a header button that opens the panel on it. The panel's contents mount the first
 * time it opens and stay while it's closed, so terminals keep running, at their width and
 * out of the keyboard's reach; the width (or closed) is kept on this Mac. `header` gets
 * the buttons to put in the page's header.
 */
export function WorkspaceLayout({
  project,
  tabs = [],
  header,
  children,
}: {
  project: { id: number; folders: string[] }
  tabs?: ExtraTab[]
  header: (controls: ReactNode) => ReactNode
  children: ReactNode
}) {
  const panel = usePanelRef()
  const contents = useRef<HTMLDivElement>(null)
  const toggleButton = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [opened, setOpened] = useState(false)
  // The panel's width when it was last open, which its contents keep while it's closed.
  const [width, setWidth] = useState(0)
  // The tab chosen in the panel, kept here so a header button can open the panel on one.
  const [chosenTab, setChosenTab] = useState<string | null>(null)
  const hasFolders = project.folders.length > 0
  const available = hasFolders || tabs.length > 0
  // One saved layout with the panel and one without, as the library needs when a panel
  // comes and goes.
  const layout = useDefaultLayout({
    id: "workspace",
    panelIds: available ? ["page", "workspace"] : ["page"],
    storage: localStorage,
  })

  function expand() {
    const handle = panel.current
    if (!handle) return
    handle.expand()
    // Never opened on this Mac: expand() knows no earlier width.
    if (handle.getSize().inPixels < MIN_SIZE) handle.resize(OPEN_SIZE)
  }

  function toggle() {
    const handle = panel.current
    if (!handle) return
    if (handle.isCollapsed()) expand()
    else handle.collapse()
  }

  /** Opens the panel on `tab`, or closes it when it already shows that tab. */
  function toggleTab(tab: string) {
    if (open && chosenTab === tab) {
      panel.current?.collapse()
      return
    }
    setChosenTab(tab)
    expand()
  }

  const onShortcut = useEffectEvent(toggle)
  useEffect(() => {
    if (!available) return
    function onKeyDown(event: KeyboardEvent) {
      if (!WORKSPACE_SHORTCUT.matches(event)) return
      event.preventDefault()
      onShortcut()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [available])

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
            <>
              {tabs.map((tab) => (
                <TabButton
                  key={tab.id}
                  tab={tab}
                  showing={open && chosenTab === tab.id}
                  onClick={() => toggleTab(tab.id)}
                />
              ))}
              {hasFolders && (
                <WorkspaceToggle
                  ref={toggleButton}
                  open={open}
                  onClick={toggle}
                />
              )}
            </>
          )
        )}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </ResizablePanel>
      {available && (
        <>
          <ResizableHandle
            className={cn(
              "transition-opacity hover:bg-ring/40 data-[separator=active]:bg-ring/60",
              !open && "pointer-events-none opacity-0"
            )}
          />
          <ResizablePanel
            id="workspace"
            panelRef={panel}
            collapsible
            defaultSize={0}
            minSize={MIN_SIZE}
            maxSize="75%"
            groupResizeBehavior="preserve-pixel-size"
            // Clipped, not squeezed: while closed, the contents keep the width they had
            // open, so a terminal never refits (and rewraps) just because it's hidden.
            style={{ overflow: "hidden" }}
            onResize={(size) => {
              const now = size.inPixels > 0
              if (now) {
                setWidth(size.inPixels)
                setOpened(true)
              } else if (contents.current?.contains(document.activeElement)) {
                // Closed from inside (⌘J while typing in a terminal): typing must not
                // go on into what can't be seen. Without folders there's no toggle.
                if (toggleButton.current) toggleButton.current.focus()
                else if (document.activeElement instanceof HTMLElement)
                  document.activeElement.blur()
              }
              setOpen(now)
            }}
          >
            {/* Closed, the contents are inert: out of reach of the keyboard and the
                pointer, and of focus. */}
            <div
              ref={contents}
              inert={!open}
              className="h-full"
              style={open ? undefined : { width }}
            >
              {opened && (
                <Suspense>
                  <WorkspacePanel
                    projectId={project.id}
                    folders={project.folders}
                    tabs={tabs}
                    open={open}
                    chosenTab={chosenTab}
                    onChooseTab={setChosenTab}
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

/** An extension's header button: its icon and count; pressed while the panel shows its tab. */
function TabButton({
  tab,
  showing,
  onClick,
}: {
  tab: ExtraTab
  showing: boolean
  onClick: () => void
}) {
  const label = showing ? `Hide ${tab.label.toLowerCase()}` : tab.label
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={label}
          aria-pressed={showing}
          onClick={onClick}
          className={cn("gap-1.5 px-2", showing && "bg-accent")}
        >
          {tab.icon}
          {tab.count !== undefined && tab.count > 0 && (
            <span className="font-mono text-xs tabular-nums">{tab.count}</span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function WorkspaceToggle({
  ref,
  open,
  onClick,
}: {
  ref: Ref<HTMLButtonElement>
  open: boolean
  onClick: () => void
}) {
  const label = open ? "Hide changes and terminal" : "Show changes and terminal"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={open}
          onClick={onClick}
        >
          {open ? <PanelRightClose /> : <PanelRightOpen />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        <KbdGroup>
          {WORKSPACE_SHORTCUT.keys.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </KbdGroup>
      </TooltipContent>
    </Tooltip>
  )
}
