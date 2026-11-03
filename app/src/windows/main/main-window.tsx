import { FolderOpen } from "lucide-react"
import { useEffect } from "react"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { openSettings, SETTINGS_SHORTCUT } from "../settings/open-settings"
import { AppHeader } from "./app-header"
import { AppSidebar } from "./app-sidebar"

/** The main window: sidebar on the left, the main panel on the right. */
export function MainWindow() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!SETTINGS_SHORTCUT.matches(event)) return
      event.preventDefault()
      void openSettings()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <SidebarProvider className="h-svh">
      <AppSidebar />
      <SidebarInset className="overflow-hidden">
        <AppHeader title="Projects" />
        <div className="flex min-h-0 flex-1 overflow-auto">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderOpen />
              </EmptyMedia>
              <EmptyTitle>No project open</EmptyTitle>
              <EmptyDescription>
                A project is a name and the folders Claude can work in. Open one
                to start a call.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
