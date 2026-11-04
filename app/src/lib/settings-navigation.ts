import { createContext, useContext } from "react"

/**
 * A place in the settings window: a section by id (`windows/settings/sections.ts`) and,
 * optionally, a field there to bring into view and focus, like "gemini" in Credentials.
 */
export type SettingsPlace = { section: string; field?: string }

type SettingsNavigation = {
  /** Where the window was last sent. */
  place: SettingsPlace | null
  go: (place: SettingsPlace) => void
}

/** Lets a section send the user to another one; the settings window provides it. */
export const SettingsNavigationContext = createContext<SettingsNavigation>({
  place: null,
  go: () => {},
})

export function useSettingsNavigation(): SettingsNavigation {
  return useContext(SettingsNavigationContext)
}
