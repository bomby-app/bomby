import type { ReactNode } from "react"

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

/**
 * One card of choices, a row each: a logo tile, a title over a line about it, and a radio
 * on the right. The chosen row opens what belongs to it below (its key, its options), so
 * each service keeps its own settings in one place (Settings, Voice and Call server).
 */
export function ChoiceList<T extends string>({
  value,
  onValueChange,
  label,
  children,
}: {
  value: T | null
  onValueChange: (value: T) => void
  /** What the radio group is for, for screen readers. */
  label: string
  children: ReactNode
}) {
  return (
    <RadioGroup
      aria-label={label}
      // Radix wants "" for no choice yet.
      value={value ?? ""}
      onValueChange={(next) => onValueChange(next as T)}
      className="gap-0 divide-y rounded-lg border bg-card"
    >
      {children}
    </RadioGroup>
  )
}

export function ChoiceRow({
  id,
  value,
  chosen,
  logo,
  title,
  description,
  badge,
  children,
}: {
  /** The radio's id, for its label. */
  id: string
  value: string
  chosen: boolean
  /** Drawn in the text colour at 18px, unless it sets its own width. */
  logo: ReactNode
  title: string
  description: string
  /** Shown after the title, like an Experimental mark. */
  badge?: ReactNode
  /** Shown under the row while it's chosen. */
  children?: ReactNode
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="flex cursor-default items-center gap-3 px-4 py-3.5"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground [&_svg:not([class*='w-'])]:size-[18px]">
          {logo}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
          <span className="flex items-center gap-2 font-medium">
            {title}
            {badge}
          </span>
          <span className="text-muted-foreground">{description}</span>
        </span>
        <RadioGroupItem value={value} id={id} />
      </label>
      {chosen && children && (
        // Lined up with the title: the row's padding, the tile and the gap.
        <div className="flex flex-col gap-3 pt-1 pr-4 pb-4 pl-16">
          {children}
        </div>
      )}
    </div>
  )
}
