import { invoke } from "@tauri-apps/api/core"

/** Writes a line to `app.log`, for what only the page sees; never fails. */
export function log(line: string) {
  void invoke("app_log", { line }).catch(() => {})
}

/** The longest error `describeError` keeps: a component stack can run to pages. */
const MAX_ERROR = 4000

/** An error as one log entry: its message and stack, or the component stack React gives. */
export function describeError(
  error: unknown,
  componentStack?: string | null
): string {
  const text =
    error instanceof Error
      ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
      : String(error)
  const full = componentStack ? `${text}\nin${componentStack}` : text
  return full.length > MAX_ERROR ? `${full.slice(0, MAX_ERROR)}...` : full
}

/**
 * Sends every error the page doesn't handle to `app.log`: a release build's webview has no
 * console anyone sees. Once per window, from `mountWindow`.
 */
export function logUnhandledErrors() {
  window.addEventListener("error", (event) => {
    log(`page error: ${describeError(event.error ?? event.message)}`)
  })
  window.addEventListener("unhandledrejection", (event) => {
    log(`unhandled rejection: ${describeError(event.reason)}`)
  })
}
