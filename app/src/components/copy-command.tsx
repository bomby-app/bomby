import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import { Check, Copy } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"

/** A command to run in Terminal, in a code box with a copy button. */
export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await writeText(command)
    } catch {
      return // the command stays selectable to copy by hand
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-xs select-text">
        {command}
      </code>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={copied ? "Copied" : "Copy"}
        onClick={() => void copy()}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  )
}
