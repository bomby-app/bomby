import { preloadHighlighter, type SupportedLanguages } from "@pierre/diffs"
import type { CSSProperties } from "react"

// Pierre's diffs (`@pierre/diffs`) in our look, for the changes and the file preview.

/**
 * Pierre's themes paint their own background (#0a0a0a in dark); ours is the panel's. The
 * theme sets it inline inside the diff's shadow root, so only `unsafeCSS` (Pierre's
 * documented escape hatch, a top cascade layer) reaches it. Custom properties from the
 * page do reach inside, so `var(--background)` follows our theme.
 */
const BACKGROUND_CSS = `:host, [data-diffs-header], pre {
  --diffs-light-bg: var(--background) !important;
  --diffs-dark-bg: var(--background) !important;
}`

/**
 * Our type and change colours, set on the element that holds the diffs: custom properties
 * inherit inside. Lines are 20 px, the height Pierre's virtualizer assumes. Added, changed
 * and removed lines take the same `--change-*` colours as the headers and the file tree.
 */
export const PIERRE_STYLE = {
  "--diffs-font-family": "var(--font-mono)",
  "--diffs-header-font-family": "var(--font-sans)",
  "--diffs-font-size": "12px",
  "--diffs-line-height": "20px",
  "--diffs-addition-color-override": "var(--change-added)",
  "--diffs-deletion-color-override": "var(--change-deleted)",
  "--diffs-modified-color-override": "var(--change-modified)",
} as CSSProperties

/** Pierre's light and dark themes on our background, following the page's theme. */
export function pierreTheme(dark: boolean) {
  return {
    theme: { dark: "pierre-dark", light: "pierre-light" },
    themeType: dark ? "dark" : "light",
    unsafeCSS: BACKGROUND_CSS,
  } as const
}

/** What most projects' files are written in: loaded ahead, the rest on demand. */
const COMMON_LANGUAGES: SupportedLanguages[] = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "css",
  "html",
  "markdown",
  "rust",
  "python",
  "shellscript",
  "toml",
  "yaml",
]

let preloading: Promise<void> | null = null

/**
 * Loads the highlighter with our themes and the common languages, once, so the first
 * diff or preview of each shows highlighted at once instead of after loading them.
 * Without it Pierre loads each on first use (`preloadHighlighter`, diffs.com/docs).
 */
export function preloadHighlighting() {
  preloading ??= preloadHighlighter({
    themes: ["pierre-dark", "pierre-light"],
    langs: COMMON_LANGUAGES,
  }).catch(() => {
    // Pierre still loads what it needs on first use.
  })
}
