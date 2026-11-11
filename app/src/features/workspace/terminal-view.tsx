import type { WTerm } from "@wterm/dom"
import { GhosttyCore } from "@wterm/ghostty"
import { Terminal } from "@wterm/react"
import { useEffect, useRef, useState } from "react"

import { ErrorCard } from "@/components/error-card"

import "./terminal.css"

import { openTerminal, type TerminalSession } from "./api"

/** Lines of history each terminal keeps. */
const SCROLLBACK_LINES = 5000

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
  active,
  onTitle,
}: {
  projectId: number
  folder: string
  active: boolean
  onTitle: (title: string) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const ghostty = useGhosttyCore(setError)
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

  /** Tells the shell the grid's size; a grid under 2 by 2 is a pane mid-layout, not one to fit. */
  function tell(cols: number, rows: number) {
    if (cols < 2 || rows < 2) return
    session.current?.resize(cols, rows)
  }

  // A tab coming back may have missed a change of size while another one showed (the
  // window or the zoom changed): fit it to its pane, tell the shell, and type into it.
  useEffect(() => {
    if (!active) return
    const frame = requestAnimationFrame(() => {
      const wt = terminal.current
      if (!wt) return
      wt.fit()
      tell(wt.cols, wt.rows)
      wt.focus()
    })
    return () => cancelAnimationFrame(frame)
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
        if (!mounted.current) {
          opened.close()
          return
        }
        session.current = opened
        // The grid may have refit while the shell started; it was told the size before.
        tell(wt.cols, wt.rows)
      },
      (e: unknown) => setError(String(e))
    )
  }

  if (error) {
    return <ErrorCard message={error} className="m-auto max-w-xs" />
  }
  if (!ghostty) return null
  return (
    <Terminal
      core={ghostty}
      autoResize
      renderingPaused={!active}
      aria-label="Terminal"
      className="bomby-terminal h-full w-full"
      onReady={start}
      onData={(data) => session.current?.write(data)}
      onBinary={(bytes) => session.current?.write(bytes)}
      onResize={tell}
      onTitle={onTitle}
    />
  )
}

/**
 * Ghostty's terminal emulation (`@wterm/ghostty`, libghostty built to WASM) for this
 * terminal while it's mounted: each terminal needs its own (the WASM module itself loads
 * once and is shared), and `WTerm.destroy()` leaves one it was given alone, so this
 * disposes it. The terminal's own cleanup runs first: a ref's cleanup (the wterm
 * component's) comes in the commit, before effect cleanups. `onError` hears why it
 * couldn't load.
 */
function useGhosttyCore(
  onError: (message: string) => void
): GhosttyCore | null {
  const [core, setCore] = useState<GhosttyCore | null>(null)
  useEffect(() => {
    let live = true
    let loaded: GhosttyCore | null = null
    GhosttyCore.load({ scrollbackLines: SCROLLBACK_LINES }).then(
      (c) => {
        if (live) {
          loaded = c
          setCore(c)
        } else {
          c.dispose()
        }
      },
      (e: unknown) => {
        if (live) onError(String(e))
      }
    )
    return () => {
      live = false
      loaded?.dispose()
    }
  }, [onError])
  return core
}
