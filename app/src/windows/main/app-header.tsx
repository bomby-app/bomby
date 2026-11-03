import { Separator } from "@/components/ui/separator"
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

/**
 * The top bar of the main panel. The bar itself drags the window; its text ignores the
 * pointer so a drag that starts on the title still moves the window.
 */
export function AppHeader({ title }: { title: string }) {
  const { state } = useSidebar()

  return (
    <header
      data-tauri-drag-region
      className={cn(
        "flex h-titlebar shrink-0 items-center gap-2 border-b px-3",
        // With the sidebar hidden, the macOS traffic lights float over this bar.
        state === "collapsed" && "macos:pl-20"
      )}
    >
      <SidebarTrigger />
      <Separator
        orientation="vertical"
        className="mr-1 data-vertical:h-4 data-vertical:self-center"
      />
      <h1 className="pointer-events-none truncate text-sm font-medium">
        {title}
      </h1>
    </header>
  )
}
