import {
  startTransition,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { CALL_NAMES_RPC } from "@/features/call-names/rpc"
import { CallProvider } from "@/features/call/call-provider"
import { ExtensionRpcBridge } from "@/features/extensions/extension-rpc-bridge"
import { useHostedMcpRpc } from "@/features/extensions/hosted-rpc"
import { TaskNotifier } from "@/features/notifications/task-notifier"
import { firstRun } from "@/features/onboarding/api"
import { Splash } from "@/features/onboarding/splash"
import { NewProjectDialog } from "@/features/projects/new-project-dialog"
import { ProjectsProvider } from "@/features/projects/projects-provider"
import type { Selection } from "@/features/projects/selection"
import { TODOS_RPC } from "@/features/todos/rpc"
import { TrayBridge } from "@/features/tray/tray-bridge"
import { log } from "@/lib/log"

import { openSettings, SETTINGS_SHORTCUT } from "../settings/open-settings"
import { AppSidebar } from "./app-sidebar"
import { CommandPalette } from "./command-palette"
import { CoreNotAnswering } from "./core-not-answering"
import { reportReady } from "./launch"
import { MainPanel } from "./main-panel"
import { NEW_PROJECT_SHORTCUT, PALETTE_SHORTCUT } from "./shortcuts"

/**
 * The main window: the first-run splash until it's finished, then the project tree on
 * the left and the selected item on the right.
 */
export function MainWindow() {
  // `null` while the core is asked; a message when it failed or didn't answer.
  const [first, setFirst] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [asked, setAsked] = useState(0)

  useEffect(() => {
    let current = true
    // Its first read of the core: a stuck core shows here, not as a blank window.
    firstRun().then(
      (first) => {
        if (current) setFirst(first)
      },
      (e: unknown) => {
        log(`Reading the first run failed: ${String(e)}`)
        if (current) setError(String(e))
      }
    )
    return () => {
      current = false
    }
  }, [asked])

  // Once, when the first screen has rendered.
  const shown = first === null ? null : first ? "splash" : "workspace"
  const reported = useRef(false)
  useEffect(() => {
    if (shown === null || reported.current) return
    reported.current = true
    void reportReady(shown)
  }, [shown])

  if (error !== null)
    return (
      <CoreNotAnswering
        message={error}
        onRetry={() => {
          setError(null)
          setAsked((n) => n + 1)
        }}
      />
    )
  // A blank window for the moment the core takes to answer, never longer than `FIRST_READ` (onboarding/api.ts).
  if (first === null) return <div className="h-svh bg-background" />
  if (first) return <Splash onDone={() => setFirst(false)} />
  return <Workspace />
}

function Workspace() {
  // What each extension answers Bomby over RPC while a call is on.
  const hostedRpc = useHostedMcpRpc()
  const extensionRpc = useMemo(
    () => [TODOS_RPC, CALL_NAMES_RPC, ...hostedRpc],
    [hostedRpc]
  )
  const [selection, setSelected] = useState<Selection>(null)
  // Moving to another page is a Transition, so the page before it stays until the next is
  // ready, a past call's lines read (`SavedCallView` suspends), rather than showing it
  // empty first (react.dev, Suspense, "Preventing already revealed content from hiding").
  function setSelection(next: Selection) {
    startTransition(() => setSelected(next))
  }
  const [creating, setCreating] = useState(false)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (SETTINGS_SHORTCUT.matches(event)) {
        event.preventDefault()
        void openSettings()
      } else if (NEW_PROJECT_SHORTCUT.matches(event)) {
        event.preventDefault()
        setCreating(true)
      } else if (PALETTE_SHORTCUT.matches(event)) {
        event.preventDefault()
        setSearching((open) => !open)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  // A new project, the menu bar and a notification all open a project.
  function openProject(projectId: number) {
    setSelection({ kind: "project", projectId })
  }

  return (
    <ProjectsProvider>
      <CallProvider>
        <SidebarProvider className="h-svh">
          <AppSidebar
            selection={selection}
            onSelect={setSelection}
            onNewProject={() => setCreating(true)}
            onSearch={() => setSearching(true)}
          />
          <SidebarInset className="overflow-hidden">
            {/* Above every page, so it's always revealed and a Transition keeps it. */}
            <Suspense fallback={null}>
              <MainPanel
                selection={selection}
                onSelect={setSelection}
                onNewProject={() => setCreating(true)}
              />
            </Suspense>
          </SidebarInset>
        </SidebarProvider>
        <CommandPalette
          open={searching}
          onOpenChange={setSearching}
          selection={selection}
          onSelect={setSelection}
          onNewProject={() => setCreating(true)}
        />
        <NewProjectDialog
          open={creating}
          onOpenChange={setCreating}
          onCreated={(project) => openProject(project.id)}
        />
        <TrayBridge onOpenProject={openProject} />
        <ExtensionRpcBridge extensions={extensionRpc} />
        <TaskNotifier onOpen={openProject} />
      </CallProvider>
    </ProjectsProvider>
  )
}
