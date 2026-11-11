import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vite-plus/test"

import { Markdown } from "./markdown"

test("an image in what an agent wrote is never fetched: it isn't rendered", () => {
  const html = renderToStaticMarkup(
    createElement(
      Markdown,
      null,
      "Here: ![preview](https://example.invalid/pixel.png?data=secret) and **bold**."
    )
  )
  expect(html).not.toContain("<img")
  expect(html).not.toContain("example.invalid")
  expect(html).toContain("bold")
})
