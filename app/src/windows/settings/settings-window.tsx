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
import {
  SettingsNavigationContext,
  type SettingsPlace,
} from "@/lib/settings-navigation"

import { SECTIONS } from "./sections"

/**
 * Settings: sections on the left, the chosen one on the right. A section can send the user
 * to another, and to a field there (`useSettingsNavigation`).
 */
export function SettingsWindow() {
  const [place, setPlace] = useState<SettingsPlace>({
    section: SECTIONS[0].id,
  })
  const section = SECTIONS.find((s) => s.id === place.section) ?? SECTIONS[0]
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
                      isActive={id === section.id}
                      // The open section stays as it is: rebuilding it would drop
                      // what the user typed there.
                      onClick={() => {
                        if (id !== section.id) setPlace({ section: id })
                      }}
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
            <SettingsNavigationContext value={{ place, go: setPlace }}>
              {/* Keyed by section, so going to the open one again runs its focus anew. */}
              <Content key={`${place.section}:${place.field ?? ""}`} />
            </SettingsNavigationContext>
          </div>
        </div>
      </main>
    </SidebarProvider>
  )
}
