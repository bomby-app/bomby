import type { ComponentProps } from "react"
import { Streamdown } from "streamdown"

// Never drawn from what a model or an agent wrote. An image is fetched as soon as it's
// rendered, with no click: text an agent picked up from a page or a repository could reach
// out from the user's Mac that way (streamdown.ai/docs/security, Streamdown 2.7.1 allows
// every image origin by default).
const LEFT_OUT = ["img"]

/**
 * Markdown a model or a coding agent wrote, drawn as it streams (Streamdown), with images
 * left out. Every place that shows such text uses this, so the rule is in one place.
 */
export function Markdown(props: ComponentProps<typeof Streamdown>) {
  return <Streamdown {...props} disallowedElements={LEFT_OUT} />
}
