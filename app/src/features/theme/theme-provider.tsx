import { emit, listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { createContext, type ReactNode, use, useEffect, useState } from "react"

import { useCoreEvent } from "@/hooks/use-core-event"

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

/** Another window changed the theme. */
function onThemeChanged(handler: (theme: Theme) => void) {
  return listen<Theme>(THEME_EVENT, ({ payload }) => {
    if (isTheme(payload)) handler(payload)
  })
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(storedTheme)

  useCoreEvent(onThemeChanged, setThemeState)

  useEffect(() => {
    // The native window (title bar, traffic lights, scroll bars) follows the same choice;
    // null hands it back to the OS. Needs core:window:allow-set-theme.
    void getCurrentWindow().setTheme(theme === "system" ? null : theme)

    if (theme !== "system") {
      applyScheme(theme === "dark")
      return
    }
    const media = window.matchMedia(DARK_QUERY)
    const sync = () => applyScheme(media.matches)
    sync()
    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  }, [theme])

  function setTheme(next: Theme) {
    localStorage.setItem(STORAGE_KEY, next)
    setThemeState(next)
    void emit(THEME_EVENT, next)
  }

  return <ThemeContext value={{ theme, setTheme }}>{children}</ThemeContext>
}

export function useTheme(): ThemeState {
  const state = use(ThemeContext)
  if (!state) throw new Error("useTheme must be used inside ThemeProvider")
  return state
}
