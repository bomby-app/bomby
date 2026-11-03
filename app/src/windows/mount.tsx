import "@/index.css"

import { type ReactNode, StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { TooltipProvider } from "@/components/ui/tooltip"
import { ThemeProvider } from "@/features/theme/theme-provider"

/**
 * Renders a window's root component with the providers every window shares. Each window's
 * entry.tsx (loaded by its HTML page) calls this once.
 */
export function mountWindow(window: ReactNode) {
  const root = document.getElementById("root")
  if (!root) throw new Error("The page has no #root element")

  createRoot(root).render(
    <StrictMode>
      <ThemeProvider>
        {/* Native tooltips wait before showing; shadcn's default of 0 feels like a web page. */}
        <TooltipProvider delay={500}>{window}</TooltipProvider>
      </ThemeProvider>
    </StrictMode>
  )
}
