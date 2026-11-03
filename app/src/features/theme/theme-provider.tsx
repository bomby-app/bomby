import { emit, listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { createContext, type ReactNode, use, useEffect, useState } from "react"

// Light, dark, or follow the OS. The choice lives in localStorage under STORAGE_KEY;
// public/boot.js reads the same key before first paint so a window never flashes the wrong
// theme. A change is broadcast as THEME_EVENT so every open window follows at once.

export type Theme = "system" | "light" | "dark"

export const THEMES: readonly Theme[] = ["system", "light", "dark"]

const STORAGE_KEY = "theme"
const THEME_EVENT = "theme-changed"
const DARK_QUERY = "(prefers-color-scheme: dark)"

type ThemeState = {
  theme: Theme
  /** What the page shows right now: the choice, or the OS's when it is "system". */
  resolved: "light" | "dark"
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeState | null>(null)

export function isTheme(value: unknown): value is Theme {
  return THEMES.includes(value as Theme)
}

function storedTheme(): Theme {
  const value = localStorage.getItem(STORAGE_KEY)
  return isTheme(value) ? value : "system"
}

/** Puts `.dark` on <html> (shadcn's dark variant) and tells native controls which scheme to draw. */
function applyScheme(dark: boolean) {
  const root = document.documentElement
  root.classList.toggle("dark", dark)
  root.style.colorScheme = dark ? "dark" : "light"
}

function shownDark(): boolean {
  return document.documentElement.classList.contains("dark")
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(storedTheme)
  // boot.js applied the scheme before first paint; start from what it chose.
  const [dark, setDark] = useState(shownDark)

  // Another window changed the theme.
  useEffect(() => {
    const unlisten = listen<Theme>(THEME_EVENT, ({ payload }) => {
      if (isTheme(payload)) setThemeState(payload)
    })
    return () => {
      void unlisten.then((stop) => stop())
    }
  }, [])

  useEffect(() => {
    // The native window (title bar, traffic lights, scroll bars) follows the same choice;
    // null hands it back to the OS. Needs core:window:allow-set-theme.
    void getCurrentWindow().setTheme(theme === "system" ? null : theme)

    const show = (next: boolean) => {
      applyScheme(next)
      setDark(next)
    }
    if (theme !== "system") {
      show(theme === "dark")
      return
    }
    const media = window.matchMedia(DARK_QUERY)
    const sync = () => show(media.matches)
    sync()
    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  }, [theme])

  function setTheme(next: Theme) {
    localStorage.setItem(STORAGE_KEY, next)
    setThemeState(next)
    void emit(THEME_EVENT, next)
  }

  return (
    <ThemeContext
      value={{ theme, resolved: dark ? "dark" : "light", setTheme }}
    >
      {children}
    </ThemeContext>
  )
}

export function useTheme(): ThemeState {
  const state = use(ThemeContext)
  if (!state) throw new Error("useTheme must be used inside ThemeProvider")
  return state
}
