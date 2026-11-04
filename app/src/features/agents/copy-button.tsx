import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import { Check, Copy } from "lucide-react"
import { type ComponentProps, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"

/**
 * Copies `text` to the clipboard and shows a check for a moment. With `children` it is a
 * labelled button ("Copy command"); without, an icon button.
 */
export function CopyButton({
  text,
  children,
  ...props
}: { text: string } & Omit<ComponentProps<typeof Button>, "onClick">) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy() {
    await writeText(text)
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1500)
  }

  const icon = copied ? <Check /> : <Copy />
  return children ? (
    <Button {...props} onClick={() => void copy()}>
      {icon}
      {copied ? "Copied" : children}
    </Button>
  ) : (
    <Button
      {...props}
      aria-label={copied ? "Copied" : "Copy command"}
      onClick={() => void copy()}
    >
      {icon}
    </Button>
  )
}
