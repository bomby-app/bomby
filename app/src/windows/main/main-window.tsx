import { useEffect, useState } from "react"

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { NewProjectDialog } from "@/features/projects/new-project-dialog"
import { ProjectsProvider } from "@/features/projects/projects-provider"
import type { Selection } from "@/features/projects/selection"
import { openSettings, SETTINGS_SHORTCUT } from "../settings/open-settings"
import { AppSidebar } from "./app-sidebar"
import { MainPanel } from "./main-panel"
import { NEW_PROJECT_SHORTCUT } from "./new-project-row"

/** The main window: the project tree on the left, the selected item on the right. */
export function MainWindow() {
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
      <SidebarProvider className="h-svh">
        <AppSidebar
          selection={selection}
          onSelect={setSelection}
          onNewProject={() => setCreating(true)}
        />
        <SidebarInset className="overflow-hidden">
          <MainPanel selection={selection} onSelect={setSelection} />
        </SidebarInset>
      </SidebarProvider>
      <NewProjectDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(project) =>
          setSelection({ kind: "project", projectId: project.id })
        }
      />
    </ProjectsProvider>
  )
}
