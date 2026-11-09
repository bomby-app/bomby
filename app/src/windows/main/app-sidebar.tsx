import { AppLogo } from "@/components/app-logo"
import { TitlebarSpacer } from "@/components/titlebar-spacer"
import { Badge } from "@/components/ui/badge"
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

/**
 * The left column: brand, New project and search, the project and call tree, settings. The brand goes
 * back to the projects home; it looks the same however it's pointed at.
 */
export function AppSidebar({
  selection,
  onSelect,
  onNewProject,
  onSearch,
}: {
  selection: Selection
  onSelect: (selection: Selection) => void
  onNewProject: () => void
  onSearch: () => void
}) {
  return (
    <Sidebar variant="inset">
      <TitlebarSpacer />

      <SidebarHeader>
        <button
          type="button"
          aria-label="Projects home"
          className="flex w-fit items-center gap-2 rounded-md px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onSelect(null)}
        >
          <AppLogo />
          <Wordmark />
          <Badge className="h-4 bg-claude px-1.5 font-mono text-label font-semibold text-claude-foreground uppercase">
            Beta
          </Badge>
        </button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <NewProjectRow onClick={onNewProject} onSearch={onSearch} />
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
