import { cn } from "@/lib/utils"

/** The `claudible` wordmark: always lowercase Bricolage Grotesque Bold (docs/brand.md). */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-heading text-base leading-5 font-bold tracking-[-0.02em]",
        className
      )}
    >
      claudible
    </span>
  )
}
