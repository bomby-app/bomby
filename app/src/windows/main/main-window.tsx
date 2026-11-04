import { useEffect, useState } from "react"

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { CallProvider } from "@/features/call/call-provider"
import { TaskNotifier } from "@/features/notifications/task-notifier"
import { firstRun } from "@/features/onboarding/api"
import { Splash } from "@/features/onboarding/splash"
import { NewProjectDialog } from "@/features/projects/new-project-dialog"
import { ProjectsProvider } from "@/features/projects/projects-provider"
import type { Selection } from "@/features/projects/selection"
import { TrayBridge } from "@/features/tray/tray-bridge"

import { openSettings, SETTINGS_SHORTCUT } from "../settings/open-settings"
import { AppSidebar } from "./app-sidebar"
import { MainPanel } from "./main-panel"
import { NEW_PROJECT_SHORTCUT } from "./new-project-row"

/**
 * The main window: the first-run splash until an agent is set up, then the project tree on
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
          onCreated={(project) =>
            setSelection({ kind: "project", projectId: project.id })
          }
        />
        <TrayBridge
          onOpenProject={(projectId) =>
            setSelection({ kind: "project", projectId })
          }
        />
        <TaskNotifier
          onOpen={(projectId) => setSelection({ kind: "project", projectId })}
        />
      </CallProvider>
    </ProjectsProvider>
  )
}
