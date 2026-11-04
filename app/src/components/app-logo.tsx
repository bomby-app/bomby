import { cn } from "@/lib/utils"

/**
 * The Dot Dot mark on its tile (Paper artboards `app-logo-light` and `app-logo-dark`).
 * Light: ink tile, highlighter bubble. Dark: highlighter tile, ink bubble, so it stays the
 * brightest thing in the sidebar. The colours are the sidebar-primary tokens, which flip
 * with the theme. Shape rules: docs/brand.md. Minimum size 16px.
 */
export function AppLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      aria-hidden
      className={cn("size-7 shrink-0", className)}
    >
      <rect width="120" height="120" rx="30" fill="var(--sidebar-primary)" />
      <g transform="translate(16.8 16.8) scale(0.72)">
        <path
          d="M60 18 A42 42 0 0 1 102 60 A42 42 0 0 1 60 102 H18 V60 A42 42 0 0 1 60 18 Z"
          fill="var(--sidebar-primary-foreground)"
        />
        <circle cx="45" cy="58" r="8.5" fill="var(--sidebar-primary)" />
        <circle cx="75" cy="58" r="8.5" fill="var(--sidebar-primary)" />
      </g>
    </svg>
  )
}
