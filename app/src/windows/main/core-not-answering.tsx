import { ErrorCard } from "@/components/error-card"
import { Button } from "@/components/ui/button"
import { ExportDiagnostics } from "@/features/about/about-settings"

/**
 * The whole main window when its first read of the core failed or didn't answer: what
 * happened, Try again, and Export diagnostics, which needs neither the database nor the
 * keychain, so it works while they're stuck.
 */
export function CoreNotAnswering({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="flex h-svh flex-col bg-background">
      <div data-tauri-drag-region className="h-titlebar shrink-0" />
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="flex w-full max-w-md flex-col gap-4">
          <ErrorCard
            message={message}
            action={
              <Button variant="outline" onClick={onRetry}>
                Try again
              </Button>
            }
          />
          <ExportDiagnostics />
        </div>
      </div>
    </div>
  )
}
