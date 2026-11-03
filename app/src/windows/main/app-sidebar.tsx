import { AppLogo } from "@/components/app-logo"
import { TitlebarSpacer } from "@/components/titlebar-spacer"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
} from "@/components/ui/sidebar"
import { Wordmark } from "@/components/wordmark"
import { ProjectTree } from "@/features/projects/project-tree"
import type { Selection } from "@/features/projects/selection"
import { NewProjectRow } from "./new-project-row"
import { SettingsButton } from "./settings-button"

/** The left column: brand, New project, the project and call tree, settings. */
export function AppSidebar({
  selection,
  onSelect,
  onNewProject,
}: {
  selection: Selection
  onSelect: (selection: Selection) => void
  onNewProject: () => void
}) {
  return (
    <Sidebar variant="inset">
      <TitlebarSpacer />

      <SidebarHeader>
        <div className="flex items-center gap-2 px-1">
          <AppLogo />
          <Wordmark />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <NewProjectRow onClick={onNewProject} />
        </SidebarGroup>
        <ProjectTree selection={selection} onSelect={onSelect} />
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center">
          <SettingsButton />
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
