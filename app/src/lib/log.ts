import { invoke } from "@tauri-apps/api/core"

/** Writes a line to `app.log`, for what only the page sees; never fails. */
export function log(line: string) {
  void invoke("app_log", { line }).catch(() => {})
}
