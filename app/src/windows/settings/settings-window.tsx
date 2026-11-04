import { getCurrentWindow } from "@tauri-apps/api/window"
import { type CSSProperties, useEffect, useState } from "react"

import { TitlebarSpacer } from "@/components/titlebar-spacer"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { SECTIONS, type SectionId } from "./sections"

/** Settings: sections on the left, the chosen one on the right. */
export function SettingsWindow() {
  const [active, setActive] = useState<SectionId>(SECTIONS[0].id)
  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0]
  const Content = section.component

  // Esc closes the window, unless something inside (a menu, a popup) handled it first.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return
      void getCurrentWindow().close()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <SidebarProvider
      className="h-svh"
      style={{ "--sidebar-width": "12rem" } as CSSProperties}
    >
      <Sidebar collapsible="none" className="border-r pt-2">
        <TitlebarSpacer />
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {SECTIONS.map(({ id, label, icon: Icon }) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      isActive={id === active}
                      onClick={() => setActive(id)}
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <main className="flex min-w-0 flex-1 flex-col bg-background">
        <header
          data-tauri-drag-region
          className="mt-2 flex h-titlebar shrink-0 items-center px-6"
        >
          <h1 className="pointer-events-none text-base font-semibold">
            {section.label}
          </h1>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-6 pt-2 pb-6">
          <div className="max-w-md">
            <Content />
          </div>
        </div>
      </main>
    </SidebarProvider>
  )
}
