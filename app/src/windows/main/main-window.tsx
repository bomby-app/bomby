import { useEffect, useState } from "react"

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { CallProvider } from "@/features/call/call-provider"
import { ExtensionRpcBridge } from "@/features/extensions/extension-rpc-bridge"
import { TaskNotifier } from "@/features/notifications/task-notifier"
import { firstRun } from "@/features/onboarding/api"
import { Splash } from "@/features/onboarding/splash"
import { NewProjectDialog } from "@/features/projects/new-project-dialog"
import { ProjectsProvider } from "@/features/projects/projects-provider"
import type { Selection } from "@/features/projects/selection"
import { TODOS_RPC } from "@/features/todos/rpc"
import { TrayBridge } from "@/features/tray/tray-bridge"

import { openSettings, SETTINGS_SHORTCUT } from "../settings/open-settings"
import { AppSidebar } from "./app-sidebar"
import { MainPanel } from "./main-panel"
import { NEW_PROJECT_SHORTCUT } from "./new-project-row"

/** What each extension answers Bomby over RPC while a call is on. */
const EXTENSION_RPC = [TODOS_RPC]

/**
 * The main window: the first-run splash until it's finished, then the project tree on
 * the left and the selected item on the right.
 */
export function MainWindow() {
  const [first, setFirst] = useState<boolean | null>(null)

  useEffect(() => {
    firstRun().then(setFirst, () => setFirst(false))
  }, [])

  if (first === null) return null
  if (first) return <Splash onDone={() => setFirst(false)} />
  return <Workspace />
}

function Workspace() {
  const [selection, setSelection] = useState<Selection>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (SETTINGS_SHORTCUT.matches(event)) {
        event.preventDefault()
        void openSettings()
      } else if (NEW_PROJECT_SHORTCUT.matches(event)) {
        event.preventDefault()
        setCreating(true)
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
          />
          <SidebarInset className="overflow-hidden">
            <MainPanel
              selection={selection}
              onSelect={setSelection}
              onNewProject={() => setCreating(true)}
            />
          </SidebarInset>
        </SidebarProvider>
        <NewProjectDialog
          open={creating}
          onOpenChange={setCreating}
          onCreated={(project) => openProject(project.id)}
        />
        <TrayBridge onOpenProject={openProject} />
        <ExtensionRpcBridge extensions={EXTENSION_RPC} />
        <TaskNotifier onOpen={openProject} />
      </CallProvider>
    </ProjectsProvider>
  )
}
