import { describe, expect, it } from "vite-plus/test"

import { charCount, cutToChars, holdToChars } from "./chars"

describe("characters as the core counts them", () => {
  it("count an emoji as one, as Rust's chars() does", () => {
    expect(charCount("🎉".repeat(30))).toBe(30)
    expect("🎉".repeat(30).length).toBe(60)
    expect(charCount("Écran")).toBe(5)
  })

  it("cut to the limit without splitting an emoji", () => {
    expect(cutToChars("🎉".repeat(61), 60)).toBe("🎉".repeat(60))
    expect(cutToChars("short", 60)).toBe("short")
  })

  it("hold a field to the limit, but never mid-composition", () => {
    const field = { value: "🎉".repeat(61) } as HTMLInputElement
    holdToChars(field, 60, true)
    expect(charCount(field.value)).toBe(61)
    holdToChars(field, 60, false)
    expect(field.value).toBe("🎉".repeat(60))
  })
})
