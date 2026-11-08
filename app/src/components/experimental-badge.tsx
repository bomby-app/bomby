/** Marks something still settling in Bomby: a voice provider, an extension, memory. */
export function ExperimentalBadge() {
  return (
    <span className="rounded-full bg-highlighter px-1.5 py-px text-label font-medium text-highlighter-foreground">
      Experimental
    </span>
  )
}
