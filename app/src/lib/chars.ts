// Text lengths as the core counts them: Rust's `chars().count()`, code points, so an emoji
// is one character. The browser's `length` and `maxLength` count UTF-16 units instead,
// where most emoji are two, so a field limited with `maxLength` fills up early.

/** How many characters `text` has, as the core counts them. */
export function charCount(text: string): number {
  return Array.from(text).length
}

/** `text` cut to at most `max` characters, as the core counts them. */
export function cutToChars(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join("") : text
}

/**
 * Holds a field to `max` characters as the core counts them, in place of `maxLength`:
 * call it on input and at a composition's end. Leaves a composition alone while it's
 * under way (Japanese, Chinese), whose text isn't final yet.
 */
export function holdToChars(
  field: HTMLInputElement | HTMLTextAreaElement,
  max: number,
  composing: boolean
) {
  if (composing || charCount(field.value) <= max) return
  field.value = cutToChars(field.value, max)
}
