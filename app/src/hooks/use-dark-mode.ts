import { useSyncExternalStore } from "react"

// Whether the page is dark right now: `.dark` on <html>, which the theme provider sets
// from the user's choice or the OS (features/theme/theme-provider.tsx). For libraries that
// take a light or dark theme as a prop rather than following our CSS variables.

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  })
  return () => observer.disconnect()
}

function isDark() {
  return document.documentElement.classList.contains("dark")
}

export function useDarkMode(): boolean {
  return useSyncExternalStore(subscribe, isDark)
}
