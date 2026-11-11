import "@/index.css"
import { type ReactNode, StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { RootErrorBoundary } from "@/components/root-error-boundary"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ThemeProvider } from "@/features/theme/theme-provider"
import { describeError, log, logUnhandledErrors } from "@/lib/log"

/**
 * Renders a window's root component with the providers every window shares. Each window's
 * entry.tsx (loaded by its HTML page) calls this once. A render error anywhere, providers
 * included, shows the boundary's card instead of a blank window, and every error the page
 * doesn't handle goes to `app.log`.
 */
export function mountWindow(content: ReactNode) {
  hideWebMenu()
  logUnhandledErrors()
  const root = document.getElementById("root")
  if (!root) throw new Error("The page has no #root element")

  createRoot(root, {
    onUncaughtError: (error, info) =>
      log(
        `uncaught render error: ${describeError(error, info.componentStack)}`
      ),
    onRecoverableError: (error) =>
      log(`recovered render error: ${describeError(error)}`),
  }).render(
    <StrictMode>
      <RootErrorBoundary>
        <ThemeProvider>
          {/* Native tooltips wait before showing; shadcn's default of 0 feels like a web page. */}
          <TooltipProvider delayDuration={500}>{content}</TooltipProvider>
          <Toaster position="bottom-center" />
        </ThemeProvider>
      </RootErrorBoundary>
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
