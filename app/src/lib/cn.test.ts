// Through the "cn" alias in vite.config.ts, as the components import it.
import { cn } from "cn"
import { describe, expect, it } from "vite-plus/test"

describe("cn", () => {
  it("keeps a type role beside a text colour", () => {
    expect(cn("text-label text-muted-foreground")).toBe(
      "text-label text-muted-foreground"
    )
    expect(cn("text-lead", "text-destructive")).toBe(
      "text-lead text-destructive"
    )
  })

  it("lets a type role replace another font size", () => {
    expect(cn("text-xs", "text-label")).toBe("text-label")
    expect(cn("text-display", "text-title")).toBe("text-title")
  })

  it("lets an elevation replace another shadow", () => {
    expect(cn("shadow-md", "shadow-float")).toBe("shadow-float")
    expect(cn("shadow-card", "shadow-none")).toBe("shadow-none")
  })
})
