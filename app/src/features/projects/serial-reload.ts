/**
 * A reload that never overlaps itself: one `read` at a time, and asking while one runs
 * reads once more after it, so answers apply in order and the last always follows the
 * last change (as `use-todos.ts` and `workspace/readings.ts` do). Every caller's promise
 * settles once a read that started after its ask has applied.
 */
export function serialReload<T>(
  read: () => Promise<T>,
  apply: (value: T) => void
): () => Promise<void> {
  let running: Promise<void> | null = null
  let again = false

  async function loop() {
    try {
      while (again) {
        again = false
        const value = await read()
        // A newer ask came during the read: its read applies instead.
        if (!again) apply(value)
      }
    } finally {
      running = null
    }
  }

  return () => {
    again = true
    running ??= loop()
    return running
  }
}
