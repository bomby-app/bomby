import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vite-plus/test"

import { KEY_PAGES } from "./key-pages"

/** The URLs a window's capability lets it open (`opener:allow-open-url`). */
function allowed(window: string): string[] {
  const file = path.resolve(
    import.meta.dirname,
    `../../../src-tauri/capabilities/${window}.json`
  )
  const capability = JSON.parse(readFileSync(file, "utf8")) as {
    permissions: (string | { identifier: string; allow?: { url: string }[] })[]
  }
  return capability.permissions.flatMap((p) =>
    typeof p === "object" && p.identifier === "opener:allow-open-url"
      ? (p.allow ?? []).map((a) => a.url)
      : []
  )
}

describe("key pages", () => {
  it("open from Settings and the splash", () => {
    // The opener refuses a URL its window doesn't allow, without a word.
    for (const window of ["settings", "main"])
      expect(allowed(window)).toEqual(
        expect.arrayContaining(Object.values(KEY_PAGES))
      )
  })
})
