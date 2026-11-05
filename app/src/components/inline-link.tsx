import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

/**
 * A link-styled button inside a sentence, in the app's link style: full-contrast text,
 * underlined on hover (docs/brand.md). For an action ("type them in", "check again") or a page that
 * opens in the browser.
 */
export function InlineLink({
  className,
  ...props
}: Omit<ComponentProps<"button">, "type">) {
  return (
    <button
      type="button"
      className={cn(
        "font-medium text-foreground decoration-foreground/40 underline-offset-[3px] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
        className
      )}
      {...props}
    />
  )
}
