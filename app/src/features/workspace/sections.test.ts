import { describe, expect, it } from "vite-plus/test"

import { folderSections } from "./sections"

const ids = (sections: { id: string }[]) => sections.map((s) => s.id)

describe("folderSections", () => {
  it("has none without a folder", () => {
    expect(
      folderSections({ folder: undefined, repo: undefined, changes: undefined })
    ).toEqual([])
  })

  it("shows Changes with its count for a folder in a repository", () => {
    const sections = folderSections({ folder: "/a", repo: true, changes: 3 })
    expect(ids(sections)).toEqual(["changes", "files", "terminal"])
    expect(sections[0].count).toBe(3)
  })

  it("shows Changes for a folder that isn't a repository, without a count", () => {
    const sections = folderSections({ folder: "/a", repo: false, changes: 3 })
    expect(ids(sections)).toEqual(["changes", "files", "terminal"])
    expect(sections[0].count).toBeUndefined()
  })

  it("shows Changes before the folder's been read", () => {
    const sections = folderSections({
      folder: "/a",
      repo: undefined,
      changes: undefined,
    })
    expect(ids(sections)).toEqual(["changes", "files", "terminal"])
  })
})
