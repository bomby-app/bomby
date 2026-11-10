import { createStore, useStore } from "@/lib/store"

import { exportDiagnostics, showDiagnostics } from "./api"

/** Where Export Diagnostics stands. */
export type DiagnosticsStatus =
  | { kind: "idle" }
  | { kind: "exporting" }
  | { kind: "saved" }
  | { kind: "failed"; message: string }

/** The status, and the name of the last zip saved this run (`null` before the first). */
export type Diagnostics = {
  status: DiagnosticsStatus
  fileName: string | null
}

/**
 * Export Diagnostics for this page, outside React, so leaving About while an export runs
 * and coming back still shows it running, then saved or failed. The core runs one export
 * at a time and keeps the zip's path; the page only keeps its name.
 */
const store = createStore<Diagnostics>({
  status: { kind: "idle" },
  fileName: null,
})

function failed(e: unknown) {
  store.set({ ...store.get(), status: { kind: "failed", message: String(e) } })
}

/** Exports the logs, unless an export is already running. */
export async function startExport(): Promise<void> {
  if (store.get().status.kind === "exporting") return
  store.set({ ...store.get(), status: { kind: "exporting" } })
  try {
    const saved = await exportDiagnostics()
    // Saved even when Finder couldn't show it: the name stays, with what to do.
    store.set({
      status: saved.finderError
        ? { kind: "failed", message: saved.finderError }
        : { kind: "saved" },
      fileName: saved.fileName,
    })
  } catch (e) {
    failed(e)
  }
}

/** Shows the last zip in Finder again. */
export async function showLastExport(): Promise<void> {
  try {
    await showDiagnostics()
    store.set({ ...store.get(), status: { kind: "saved" } })
  } catch (e) {
    failed(e)
  }
}

export function useDiagnostics(): Diagnostics {
  return useStore(store)
}
