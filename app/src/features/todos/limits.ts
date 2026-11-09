import type { Words } from "./view-state"

/**
 * The core's limits on a to-do's words (`MAX_TITLE_LEN` and `MAX_NOTES_LEN` in
 * `src-tauri/src/extensions/todos.rs`), so the page can count down to them. The core
 * counts characters, as `length` does here.
 */
export const TITLE_MAX = 120
export const NOTES_MAX = 1000

/** Characters as the core counts them: code points, so an emoji is one. */
export function length(text: string): number {
  // Code points on purpose: the core's `chars().count()`, not what a reader calls one.
  return Array.from(text.trim()).length
}

/** What's left of `max`, shown once it gets close; null before then. */
export function remaining(text: string, max: number): number | null {
  const left = max - length(text)
  return left <= Math.max(20, max * 0.1) ? left : null
}

/**
 * Whether the words can be saved: a title, and each within the core's limits. Given what
 * they `was`, only a changed one counts, since the core checks only what changes and a
 * to-do may predate the limits.
 */
export function fits(words: Words, was?: Words): boolean {
  const over = (key: keyof Words, max: number) =>
    (was === undefined || words[key] !== was[key]) && length(words[key]) > max
  return (
    words.title.trim().length > 0 &&
    !over("title", TITLE_MAX) &&
    !over("notes", NOTES_MAX)
  )
}
