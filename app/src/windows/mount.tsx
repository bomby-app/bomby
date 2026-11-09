import "@/index.css"
import { type ReactNode, StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ThemeProvider } from "@/features/theme/theme-provider"

/**
 * Renders a window's root component with the providers every window shares. Each window's
 * entry.tsx (loaded by its HTML page) calls this once.
 */
export function mountWindow(content: ReactNode) {
  hideWebMenu()
  const root = document.getElementById("root")
  if (!root) throw new Error("The page has no #root element")

  createRoot(root).render(
    <StrictMode>
      <ThemeProvider>
        {/* Native tooltips wait before showing; shadcn's default of 0 feels like a web page. */}
        <TooltipProvider delayDuration={500}>{content}</TooltipProvider>
        <Toaster position="bottom-center" />
      </ThemeProvider>
    </StrictMode>
  )
}

/**
 * A desktop app has no web page menu (Reload, Inspect Element). Right-click keeps the
 * system's own menu only where it belongs: text fields and selected text (copy, paste).
 */
function hideWebMenu() {
  document.addEventListener("contextmenu", (event) => {
    const target = event.target as HTMLElement | null
    const editable = target?.closest(
      "input, textarea, [contenteditable='true']"
    )
    const selected = (window.getSelection()?.toString() ?? "") !== ""
    if (!editable && !selected) event.preventDefault()
  })
}
