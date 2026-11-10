import { describe, expect, it } from "vite-plus/test"

import { andList, folderName } from "./text"

describe("folderName", () => {
  it("is the path's last part, trailing slash or not", () => {
    expect(folderName("/Users/me/Dev/samba")).toBe("samba")
    expect(folderName("/Users/me/Dev/samba/")).toBe("samba")
  })

  it("keeps a backslash, an ordinary character in a macOS name", () => {
    expect(folderName("/Users/me/a\\b")).toBe("a\\b")
  })

  it("is the path itself when it has no parts", () => {
    expect(folderName("/")).toBe("/")
  })
})

describe("andList", () => {
  it("joins names as a sentence does", () => {
    expect(andList([])).toBe("")
    expect(andList(["a"])).toBe("a")
    expect(andList(["a", "b"])).toBe("a and b")
    expect(andList(["a", "b", "c"])).toBe("a, b and c")
  })
})
