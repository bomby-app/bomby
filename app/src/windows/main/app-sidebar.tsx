import { AppLogo } from "@/components/app-logo"
import { TitlebarSpacer } from "@/components/titlebar-spacer"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
} from "@/components/ui/sidebar"
import { SettingsButton } from "./settings-button"

/** The left column: brand, projects, settings. */
export function AppSidebar() {
  return (
    <Sidebar variant="inset">
      <TitlebarSpacer />

      <SidebarHeader>
        <div className="flex items-center gap-2 px-1">
          <AppLogo />
          <span className="truncate text-sm font-semibold">Claude LiveKit</span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <p className="px-2 py-1 text-sm text-muted-foreground">
              No projects yet
            </p>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center">
          <SettingsButton />
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
