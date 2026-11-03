import { SquarePen } from "lucide-react"

import { Kbd, KbdGroup } from "@/components/ui/kbd"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { commandShortcut } from "@/lib/shortcuts"

export const NEW_PROJECT_SHORTCUT = commandShortcut("n")

/** The sidebar's top row. Its shortcut shows on hover, as in other desktop apps. */
export function NewProjectRow({ onClick }: { onClick: () => void }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton onClick={onClick}>
          <SquarePen />
          <span>New project</span>
          <KbdGroup className="ml-auto opacity-0 transition-opacity group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100">
            {NEW_PROJECT_SHORTCUT.keys.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </KbdGroup>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
