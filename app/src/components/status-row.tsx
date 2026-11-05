import { ChevronDown, LoaderCircle, Minus, ThumbsUp, X } from "lucide-react"
import type { ReactNode } from "react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

/**
 * One row of a settings checklist (Setup, Agents): a logo, what it is and its state, then
 * the status mark at the end. `ready` undefined or null means still checking. When it isn't
 * ready, `action` (what to do about it, like a button to add a key) takes the mark's place.
 *
 * With `expand`, the row opens and closes on a click to show more under it (an agent's
 * model and effort), with a chevron before the mark; its content lines up with the name.
 */
export function StatusRow({
  logo,
  name,
  ready,
  detail,
  action,
  expand,
}: {
  logo: ReactNode
  name: string
  ready: boolean | null | undefined
  detail: ReactNode
  action?: ReactNode
  expand?: {
    open: boolean
    onOpenChange: (open: boolean) => void
    content: ReactNode
  }
}) {
  const checking = ready === undefined || ready === null
  const summary = (
    <>
      <span className="flex size-6 shrink-0 items-center justify-center text-foreground [&_svg]:size-5">
        {logo}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{name}</span>
        <span className="text-sm text-muted-foreground">
          {checking ? "Checking..." : detail}
        </span>
      </span>
    </>
  )
  const mark = (
    <StatusMark state={checking ? "checking" : ready ? "ready" : "missing"} />
  )
  if (expand && !checking)
    return (
      <Collapsible
        asChild
        open={expand.open}
        onOpenChange={expand.onOpenChange}
      >
        <li>
          <CollapsibleTrigger className="group/row flex w-full items-center gap-3 px-3 py-3 text-start outline-none hover:bg-muted/40 focus-visible:bg-muted/40">
            {summary}
            <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground group-hover/row:text-foreground">
              <ChevronDown className="size-4 transition-transform duration-200 group-data-[state=open]/row:rotate-180" />
            </span>
            {mark}
          </CollapsibleTrigger>
          <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
            {/* Under the name: the row's padding, the logo and the gap after it. */}
            <div className="ps-12 pe-3 pb-3">{expand.content}</div>
          </CollapsibleContent>
        </li>
      </Collapsible>
    )
  return (
    <li className="flex items-center gap-3 px-3 py-3">
      {summary}
      {!checking && !ready && action !== undefined ? action : mark}
    </li>
  )
}

/**
 * Ready is an ink thumbs-up on a highlighter disc, missing an ink cross on bubblegum (the
 * brand's colour for problems). Both fills hold ink at full contrast in light and dark. Off
 * is a quiet dash on muted, for something optional that just isn't there.
 */
export function StatusMark({
  state,
}: {
  state: "checking" | "ready" | "missing" | "off"
}) {
  if (state === "checking") {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center">
        <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
      </span>
    )
  }
  if (state === "off") {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Minus className="size-3.5" strokeWidth={2.5} />
        <span className="sr-only">Not installed</span>
      </span>
    )
  }
  return (
    <span
      className={
        state === "ready"
          ? "flex size-6 shrink-0 items-center justify-center rounded-full bg-highlighter text-highlighter-foreground"
          : "flex size-6 shrink-0 items-center justify-center rounded-full bg-claude text-claude-foreground"
      }
    >
      {state === "ready" ? (
        <ThumbsUp className="size-3.5" strokeWidth={2.25} />
      ) : (
        <X className="size-3.5" strokeWidth={2.5} />
      )}
      <span className="sr-only">{state === "ready" ? "Ready" : "Missing"}</span>
    </span>
  )
}
