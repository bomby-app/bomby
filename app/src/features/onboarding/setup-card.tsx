import { LoaderCircle } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * One thing the splash sets up, on Paper's card (page "splash", Setup): a tile, a name, a
 * status line, and what to do about it.
 */
export function SetupCard({
  tile,
  name,
  status,
  action,
  className,
}: {
  tile: ReactNode
  name: string
  status: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex w-[440px] items-center gap-4 rounded-[18px] border bg-card p-4 shadow-[0_1px_2px_rgb(18_18_18/0.04),0_12px_32px_-12px_rgb(18_18_18/0.12)] dark:shadow-[0_12px_32px_-12px_rgb(0_0_0/0.6)]",
        className
      )}
    >
      {tile}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-base leading-5 font-semibold">{name}</span>
        {status}
      </div>
      {action}
    </div>
  )
}

/** A logo on its 56 px tile (32 px when `small`), in the theme's colours unless given. */
export function Tile({
  children,
  small = false,
  className,
}: {
  children: ReactNode
  small?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center bg-muted text-foreground",
        small
          ? "size-8 rounded-[9px] [&_svg]:size-[18px]"
          : "size-14 rounded-[14px] [&_svg]:size-[30px]",
        className
      )}
    >
      {children}
    </span>
  )
}

export type Tone = "looking" | "todo" | "done"

/** The card's status: a dot (bubblegum while something's missing) and a mono line. */
export function StatusLine({ tone, text }: { tone: Tone; text: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {tone === "looking" ? (
        <LoaderCircle className="size-3 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            tone === "todo" ? "bg-claude" : "bg-primary"
          )}
        />
      )}
      <span
        title={text}
        className="truncate font-mono text-xs leading-4 text-foreground/55"
      >
        {text}
      </span>
    </span>
  )
}

/** Paper's card button: ink with highlighter text in light, the reverse in dark. */
export const CARD_BUTTON =
  "h-auto shrink-0 rounded-[12px] px-[18px] py-[11px] text-sm leading-[18px] font-semibold"

/** The splash step's heading and the line under it. */
export function StepHeading({ title, body }: { title: string; body: string }) {
  return (
    <>
      <h1 className="pt-1.5 font-heading text-[34px] leading-[38px] font-bold tracking-[-0.03em]">
        {title}
      </h1>
      <p className="mt-2.5 w-[400px] text-center text-[15px] leading-[22px] text-foreground/60">
        {body}
      </p>
    </>
  )
}
