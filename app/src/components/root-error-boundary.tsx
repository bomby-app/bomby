import { Component, type ErrorInfo, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { describeError, log } from "@/lib/log"

import { ErrorCard } from "./error-card"

/**
 * Catches a render error anywhere in a window, providers included, so the window shows what
 * happened and a way out instead of going blank (React unmounts the whole root on an
 * uncaught one). Its fallback uses no provider or context: they may be what threw.
 */
export class RootErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    log(`window failed to render: ${describeError(error, info.componentStack)}`)
  }

  override render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex h-svh flex-col bg-background">
        <div data-tauri-drag-region className="h-titlebar shrink-0" />
        <div className="flex flex-1 items-center justify-center p-6">
          <ErrorCard
            className="w-full max-w-md"
            message="Something went wrong in this window. Reload it; if it keeps happening, export diagnostics from Settings, About."
            action={
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
              >
                Reload
              </Button>
            }
          />
        </div>
      </div>
    )
  }
}
