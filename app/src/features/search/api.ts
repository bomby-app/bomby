import { invoke } from "@tauri-apps/api/core"

import type { CallHit, ProjectHit, SearchResults } from "@/generated/search"

// The core's search (src-tauri/src/search.rs): projects by name, calls by what was said.

export type { CallHit, ProjectHit, SearchResults }

export function search(query: string): Promise<SearchResults> {
  return invoke("search", { query })
}
