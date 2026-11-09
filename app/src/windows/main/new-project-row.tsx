import { Search, SquarePen } from "lucide-react"

import { ShortcutKeys } from "@/components/shortcut-keys"
import { Button } from "@/components/ui/button"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import { NEW_PROJECT_SHORTCUT, PALETTE_SHORTCUT } from "./shortcuts"

/**
 * The sidebar's top row: New project, its shortcut showing on hover as in other desktop
 * apps, and beside it search, which opens the command palette.
 */
export function NewProjectRow({
  onClick,
  onSearch,
}: {
  onClick: () => void
  onSearch: () => void
}) {
  return (
    <div className="flex items-center gap-1">
      <SidebarMenu className="min-w-0 flex-1">
        <SidebarMenuItem>
          <SidebarMenuButton onClick={onClick}>
            <SquarePen />
            <span>New project</span>
            <ShortcutKeys
              shortcut={NEW_PROJECT_SHORTCUT}
              className="ml-auto opacity-0 transition-opacity group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100"
            />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Search"
            onClick={onSearch}
            className="shrink-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <Search />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Search
          <ShortcutKeys shortcut={PALETTE_SHORTCUT} />
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
