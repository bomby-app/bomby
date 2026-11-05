import type { SVGProps } from "react"

import zepLogo from "@/assets/zep-logo.svg"
import { cn } from "@/lib/utils"

// The logos of the services a call needs, for Settings > Setup (agents have theirs in
// features/agents). Drawn in `currentColor`, so they follow the theme like text. Each names
// what Bomby uses, never a co-brand (docs/brand.md).

export function LiveKitLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        d="M0 0v24h14.4v-4.799h4.8V24H24v-4.8h-4.799v-4.8h-4.8v4.8H4.8V0H0zm14.4 14.4V9.602h4.801V4.8H24V0h-4.8v4.8h-4.8v4.8H9.6v4.8h4.8z"
        fill="currentColor"
      />
    </svg>
  )
}

export function GeminiLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 82.286 82.286" aria-hidden="true" {...props}>
      <path
        d="M37.851 66.24Q41.143 73.749 41.143 82.286q0-8.537 3.188-16.046 3.291-7.509 8.846-13.063t13.063-8.743Q73.749 41.143 82.286 41.143q-8.537 0-16.046-3.189a42.171 42.171 0 0 1-13.063-8.845 42.171 42.171 0 0 1-8.846-13.063Q41.143 8.537 41.143 0q0 8.537-3.292 16.046-3.189 7.509-8.742 13.063a42.171 42.171 0 0 1-13.063 8.845Q8.537 41.143 0 41.143q8.537 0 16.046 3.291 7.509 3.189 13.063 8.743t8.742 13.063"
        fill="currentColor"
      />
    </svg>
  )
}

/** Zep's mark from its file, painted in the text colour like the others (a CSS mask). */
export function ZepLogo({ className }: { className?: string }) {
  const mask = `url(${zepLogo}) center / contain no-repeat`
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block shrink-0 bg-current", className)}
      style={{ mask, WebkitMask: mask }}
    />
  )
}
