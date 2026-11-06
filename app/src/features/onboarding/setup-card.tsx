import { ClipboardPaste, LoaderCircle } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
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
  collapsed = false,
  className,
}: {
  tile: ReactNode
  name: string
  status?: ReactNode
  action?: ReactNode
  /** Only the tile shows; the name and status fade out. */
  collapsed?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex w-[440px] items-center gap-4 rounded-2xl border bg-card p-4 shadow-card",
        className
      )}
    >
      {tile}
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-1 whitespace-nowrap transition-opacity duration-300",
          collapsed && "opacity-0"
        )}
      >
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
          : "size-14 rounded-xl [&_svg:not([class*='w-'])]:size-[30px]",
        className
      )}
    >
      {children}
    </span>
  )
}

export type Tone = "looking" | "todo" | "done" | "cloud" | "off"

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
            tone === "todo"
              ? "bg-claude"
              : tone === "cloud"
                ? "bg-livekit-cloud"
                : tone === "off"
                  ? "bg-muted-foreground"
                  : "bg-primary"
          )}
        />
      )}
      <span
        title={text}
        className="truncate font-mono text-xs leading-4 text-muted-foreground"
      >
        {text}
      </span>
    </span>
  )
}

/** Paper's card button: ink with highlighter text in light, the reverse in dark. */
export const CARD_BUTTON =
  "h-auto shrink-0 rounded-[12px] px-[18px] py-[11px] text-sm leading-[18px] font-semibold"

/** A card's paste button, one width so the paste buttons line up; a form's submit. */
export function PasteButton({
  disabled,
  children,
}: {
  disabled: boolean
  children: string
}) {
  return (
    <Button
      type="submit"
      disabled={disabled}
      className={cn(CARD_BUTTON, "w-32")}
    >
      <ClipboardPaste />
      {children}
    </Button>
  )
}

/** The splash step's heading and the line under it. */
export function StepHeading({ title, body }: { title: string; body: string }) {
  return (
    <>
      <h1 className="pt-1.5 font-heading text-title font-bold">{title}</h1>
      <p className="mt-2.5 w-[400px] text-center text-lead text-muted-foreground">
        {body}
      </p>
    </>
  )
}
