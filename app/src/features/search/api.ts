import type { CallHit, ProjectHit, SearchResults } from "@/generated/search"
import { call } from "@/lib/core"

// The core's search (src-tauri/src/search.rs): projects by name, calls by what was said.

export type { CallHit, ProjectHit, SearchResults }

export function search(query: string): Promise<SearchResults> {
  return call("search", { query })
}
