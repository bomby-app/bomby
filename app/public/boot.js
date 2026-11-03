// Runs in every window before first paint (a classic script in each HTML page), so a window
// opens in the right theme and layout. Must match src/features/theme/theme-provider.tsx
// (localStorage key "theme") and the `macos` variant in src/index.css.
;(() => {
  const root = document.documentElement
  root.dataset.platform = /Mac/.test(navigator.userAgent) ? "macos" : "other"
  const theme = localStorage.getItem("theme")
  const dark =
    theme === "dark" ||
    (theme !== "light" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
  root.classList.toggle("dark", dark)
  root.style.colorScheme = dark ? "dark" : "light"
})()
