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

/** Our type, set on the element that holds the diffs: custom properties inherit inside. */
export const PIERRE_STYLE = {
  "--diffs-font-family": "var(--font-mono)",
  "--diffs-header-font-family": "var(--font-sans)",
  "--diffs-font-size": "12px",
  "--diffs-line-height": "1.6",
} as CSSProperties

/** Pierre's light and dark themes on our background, following the page's theme. */
export function pierreTheme(dark: boolean) {
  return {
    theme: { dark: "pierre-dark", light: "pierre-light" },
    themeType: dark ? "dark" : "light",
    unsafeCSS: BACKGROUND_CSS,
  } as const
}
