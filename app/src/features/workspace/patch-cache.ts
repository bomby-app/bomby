// Parsing a patch is the costly part of drawing Changes, so each patch is parsed once
// for as long as it's shown: folding a file or a refresh that left a patch alone reuses
// its parse, and the parse of a patch no longer shown is dropped.

/**
 * Returns `read(patches)`, the parse of each patch by its text: `parse` runs only for a
 * patch the last call didn't have. Only the patches of the latest call are kept.
 */
export function patchCache<T>(parse: (patch: string) => T) {
  let kept = new Map<string, T>()
  return (patches: readonly string[]): ReadonlyMap<string, T> => {
    const next = new Map<string, T>()
    for (const patch of patches) {
      if (next.has(patch)) continue
      next.set(patch, kept.has(patch) ? (kept.get(patch) as T) : parse(patch))
    }
    kept = next
    return next
  }
}
