import type { WTerm } from "@wterm/dom"
import { GhosttyCore } from "@wterm/ghostty"
import { Terminal } from "@wterm/react"
import { use, useEffect, useRef, useState } from "react"

import { ErrorCard } from "@/components/error-card"

import { openTerminal, type TerminalSession } from "./api"

/** Lines of history each terminal keeps. */
const SCROLLBACK_LINES = 5000

/**
 * Ghostty's terminal emulation (`@wterm/ghostty`, libghostty built to WASM) for one
 * terminal. Each terminal needs its own; the WASM module itself loads once and is shared.
 */
export function loadTerminalCore(): Promise<GhosttyCore> {
  return GhosttyCore.load({ scrollbackLines: SCROLLBACK_LINES })
}

/** What the shell is told when it has gone, in the terminal's dim style. */
const ENDED =
  "\r\n\x1b[2mThis shell has ended. Open a new terminal with +.\x1b[0m\r\n"

/**
 * One terminal: the user's login shell in the folder, drawn by wterm on Ghostty's core
 * (DOM text, so selection, copy and find are the system's own). The shell starts once the
 * terminal knows its size and closes when this unmounts. `active` is whether its tab
 * shows: hidden ones keep running but don't paint.
 */
export function TerminalView({
  projectId,
  folder,
  core,
  active,
  onTitle,
}: {
  projectId: number
  folder: string
  core: Promise<GhosttyCore>
  active: boolean
  onTitle: (title: string) => void
}) {
  const ghostty = use(core)
  const [error, setError] = useState<string | null>(null)
  const session = useRef<TerminalSession | null>(null)
  const terminal = useRef<WTerm | null>(null)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      session.current?.close()
      session.current = null
    }
  }, [])

  useEffect(() => {
    if (active) terminal.current?.focus()
  }, [active])

  function start(wt: WTerm) {
    terminal.current = wt
    openTerminal({
      projectId,
      folder,
      cols: wt.cols,
      rows: wt.rows,
      onOutput: (bytes) => wt.write(bytes),
      onExit: () => wt.write(ENDED),
    }).then(
      (opened) => {
        if (mounted.current) session.current = opened
        else opened.close()
      },
      (e: unknown) => setError(String(e))
    )
  }

  if (error) {
    return <ErrorCard message={error} className="m-auto max-w-xs" />
  }
  return (
    <Terminal
      core={ghostty}
      autoResize
      renderingPaused={!active}
      aria-label="Terminal"
      className="bomby-terminal h-full w-full"
      onReady={start}
      onData={(data) => session.current?.write(data)}
      onResize={(cols, rows) => session.current?.resize(cols, rows)}
      onTitle={onTitle}
    />
  )
}
