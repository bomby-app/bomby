import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import { Check, Copy } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { ClaudeCodeLogo } from "./agent-logos"

// Claude Code's own installer (claude.ai/install.sh).
const INSTALL = "curl -fsSL https://claude.ai/install.sh | bash"

/** Shown in place of the agent list when none is installed: how to get Claude Code. */
export function InstallFirstAgent() {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await writeText(INSTALL)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-6 shrink-0 items-center justify-center text-foreground [&_svg]:size-5">
          <ClaudeCodeLogo />
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Install your first agent</span>
          <span className="text-sm text-muted-foreground">
            Run this in Terminal to get Claude Code, then check again.
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-md bg-muted py-1.5 pr-1.5 pl-3">
        <code className="min-w-0 flex-1 truncate font-mono text-xs select-text">
          {INSTALL}
        </code>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={copied ? "Copied" : "Copy command"}
          onClick={() => void copy()}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  )
}
