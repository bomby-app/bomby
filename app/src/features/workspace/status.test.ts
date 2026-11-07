import { describe, expect, it } from "vite-plus/test"

import type { ChangedFile, Changes } from "./api"
import { splitPath, treeStatuses } from "./status"

function file(path: string, status: ChangedFile["status"]): ChangedFile {
  return {
    path,
    oldPath: null,
    status,
    additions: 0,
    deletions: 0,
    patch: "",
  }
}

function changes(within: string, files: ChangedFile[]): Changes {
  return { within, files, truncated: false }
}

describe("treeStatuses", () => {
  it("marks each changed file and every folder above it", () => {
    const tree = treeStatuses(
      changes("", [
        file("src/lib/a.ts", "modified"),
        file("new.md", "untracked"),
      ])
    )
    expect(tree.files.get("src/lib/a.ts")).toBe("modified")
    expect(tree.files.get("new.md")).toBe("untracked")
    expect([...tree.dirs].sort()).toEqual(["src", "src/lib"])
  })

  it("names files from the folder when it's inside the repository", () => {
    const tree = treeStatuses(
      changes("app", [file("app/src/main.rs", "added")])
    )
    expect([...tree.files.keys()]).toEqual(["src/main.rs"])
    expect([...tree.dirs]).toEqual(["src"])
  })

  it("has nothing to mark outside git", () => {
    expect(treeStatuses(null).files.size).toBe(0)
  })
})

describe("splitPath", () => {
  it("splits the folder from the name", () => {
    expect(splitPath("src/lib/a.ts")).toEqual(["src/lib/", "a.ts"])
    expect(splitPath("README.md")).toEqual(["", "README.md"])
  })
})
