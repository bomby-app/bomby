import { describe, expect, it } from "vite-plus/test"

import main from "../../../src-tauri/capabilities/main.json"
import settings from "../../../src-tauri/capabilities/settings.json"
import { KEY_PAGES } from "./key-pages"

type Capability = {
  permissions: (string | { identifier: string; allow?: { url: string }[] })[]
}

/** The URLs a window's capability lets it open (`opener:allow-open-url`). */
function allowed(capability: Capability): string[] {
  return capability.permissions.flatMap((p) =>
    typeof p === "object" && p.identifier === "opener:allow-open-url"
      ? (p.allow ?? []).map((a) => a.url)
      : []
  )
}

describe("key pages", () => {
  it("open from Settings and the splash", () => {
    // The opener refuses a URL its window doesn't allow, without a word.
    for (const capability of [settings, main])
      expect(allowed(capability)).toEqual(
        expect.arrayContaining(Object.values(KEY_PAGES))
      )
  })
})
