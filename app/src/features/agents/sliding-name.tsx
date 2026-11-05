import { useEffect, useRef } from "react"

/**
 * A name too long for its box, cut at faded edges, that slides to its end and back after:
 * while its list item is highlighted (by mouse or keyboard), or a box marked
 * `data-sliding-names` is hovered. A name that fits never moves. It fills the width its box
 * gives it, so the box needs a width of its own. Styled in index.css (`sliding-name`).
 */
export function SlidingName({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null)

  // A constant speed, not a constant duration, which CSS can't derive from a width. Measured
  // up front: the row is highlighted before any handler here would run.
  useEffect(() => {
    const text = ref.current
    const box = text?.parentElement
    if (!text || !box) return
    const measure = () => {
      const overflow = Math.max(0, text.scrollWidth - box.clientWidth)
      text.style.setProperty("--slide-ms", `${Math.round(overflow * 26)}ms`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(text)
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  return (
    <span data-slot="sliding-name">
      <span ref={ref} data-slot="sliding-name-text">
        {name}
      </span>
    </span>
  )
}
