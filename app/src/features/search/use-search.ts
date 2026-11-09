import { useEffect, useState } from "react"

import { search, type SearchResults } from "./api"

/** How long typing pauses before the core is asked. */
const PAUSE_MS = 120

/**
 * The core's results for `query`, once typing pauses; null before the first answer and for
 * an empty query. An answer for an older query never replaces a newer one.
 */
export function useSearch(query: string): {
  results: SearchResults | null
  error: string | null
} {
  const [answer, setAnswer] = useState<{
    results: SearchResults | null
    error: string | null
  }>({ results: null, error: null })
  const wanted = query.trim()

  useEffect(() => {
    if (!wanted) return
    // Cancelled when the query changes or the palette closes.
    const superseded = new AbortController()
    const timer = setTimeout(() => {
      search(wanted).then(
        (results) => {
          if (!superseded.signal.aborted) setAnswer({ results, error: null })
        },
        (e: unknown) => {
          if (!superseded.signal.aborted)
            setAnswer({ results: null, error: String(e) })
        }
      )
    }, PAUSE_MS)
    return () => {
      superseded.abort()
      clearTimeout(timer)
    }
  }, [wanted])

  // The last answer stays while the next is asked for, so the list doesn't flicker.
  if (!wanted) return { results: null, error: null }
  return { results: answer.results, error: answer.error }
}
