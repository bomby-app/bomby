import { Channel } from "@tauri-apps/api/core"

import type {
  Changes,
  Entry,
  FilePreview,
  FolderInfo,
} from "@/generated/workspace"
import { call } from "@/lib/core"
import { log } from "@/lib/log"

// The core's workspace commands (src-tauri/src/workspace/): a project's folder, its git
// changes and files, a watch that says when they change, and terminals. Every call names
// the project and one of its folders; the core checks the folder is the project's.

export type {
  ChangedFile,
  Changes,
  ChangeStatus,
  Entry,
  FilePreview,
  FolderInfo,
} from "@/generated/workspace"

export function folderInfo(
  projectId: number,
  folder: string
): Promise<FolderInfo> {
  return call("folder_info", { projectId, folder }, { timeout: 60_000 })
}

/** What changed since the last commit; null when the folder isn't in a git repository. */
export function folderChanges(
  projectId: number,
  folder: string
): Promise<Changes | null> {
  return call("folder_changes", { projectId, folder }, { timeout: 60_000 })
}

/** One directory of the folder, `""` for the folder itself: folders first, then files. */
export function folderEntries(
  projectId: number,
  folder: string,
  dir: string
): Promise<Entry[]> {
  return call("folder_entries", { projectId, folder, dir })
}

export function folderFile(
  projectId: number,
  folder: string,
  file: string
): Promise<FilePreview> {
  return call("folder_file", { projectId, folder, file })
}

/** An image's bytes, for a blob URL (`FilePreview.image` says it is one, and its type). */
export function folderImage(
  projectId: number,
  folder: string,
  file: string
): Promise<ArrayBuffer> {
  return call("folder_image", { projectId, folder, file })
}

/**
 * Calls `onChange` after each burst of changes in the folder (debounced in the core).
 * Resolves to the function that stops watching. A watch the core starts after the page
 * gave up waiting is stopped as soon as its id arrives: nothing shows it, and it would
 * watch the folder until Bomby quits.
 */
export async function watchFolder(
  projectId: number,
  folder: string,
  onChange: () => void
): Promise<() => void> {
  const changed = new Channel<null>()
  changed.onmessage = onChange
  const id = await call<number>(
    "watch_folder",
    {
      projectId,
      folder,
      changed,
    },
    { late: (id) => quietly("unwatch_folder", { id }) }
  )
  return () => quietly("unwatch_folder", { id })
}

function quietly(command: string, args: Record<string, unknown>) {
  void call(command, args).catch((e: unknown) =>
    log(`${command}: ${String(e)}`)
  )
}

export type TerminalSession = {
  /** Typed or pasted text, or raw bytes (mouse reports past ASCII). */
  write: (data: string | Uint8Array) => void
  /** The grid changed; the shell hears of it once resizing settles. */
  resize: (cols: number, rows: number) => void
  close: () => void
}

/** How long the grid must stay one size before the shell is told (a drag sends dozens). */
const RESIZE_SETTLE_MS = 60

/**
 * Starts the user's login shell in the folder, on a terminal of `cols` by `rows`. Its
 * output arrives as bytes on `onOutput`; `onExit` gets the exit code once it has gone.
 * A shell the core starts after the page gave up waiting is closed as soon as its id
 * arrives: no tab shows it, and it would run until Bomby quits.
 */
export async function openTerminal({
  projectId,
  folder,
  cols,
  rows,
  onOutput,
  onExit,
}: {
  projectId: number
  folder: string
  cols: number
  rows: number
  onOutput: (bytes: Uint8Array) => void
  onExit: (code: number | null) => void
}): Promise<TerminalSession> {
  // The core sends raw bytes, which arrive as an ArrayBuffer.
  const output = new Channel<ArrayBuffer>()
  output.onmessage = (buffer) => onOutput(new Uint8Array(buffer))
  const exit = new Channel<number | null>()
  exit.onmessage = onExit
  const id = await call<number>(
    "terminal_open",
    {
      projectId,
      folder,
      cols,
      rows,
      output,
      exit,
    },
    { late: (id) => quietly("terminal_close", { id }) }
  )
  // Tauri runs each command as its own task, so two can overtake each other: every input
  // carries its number and the core applies them in that order (terminals.rs, Inbox).
  let seq = 0
  let size = { cols, rows }
  let settling: ReturnType<typeof setTimeout> | undefined
  return {
    write: (data) =>
      quietly("terminal_write", {
        id,
        seq: seq++,
        data: typeof data === "string" ? data : Array.from(data),
      }),
    resize: (cols, rows) => {
      clearTimeout(settling)
      settling = setTimeout(() => {
        if (cols === size.cols && rows === size.rows) return
        size = { cols, rows }
        quietly("terminal_resize", { id, seq: seq++, cols, rows })
      }, RESIZE_SETTLE_MS)
    },
    close: () => {
      clearTimeout(settling)
      quietly("terminal_close", { id })
    },
  }
}
