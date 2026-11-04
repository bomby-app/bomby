import { ClaudeCodeLogo } from "./agent-logos"
import { CopyButton } from "./copy-button"

// Claude Code's own installer (claude.ai/install.sh).
const INSTALL = "curl -fsSL https://claude.ai/install.sh | bash"

/** Shown in place of the agent list when none is installed: how to get Claude Code. */
export function InstallFirstAgent() {
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
        <CopyButton text={INSTALL} variant="ghost" size="icon-sm" />
      </div>
    </div>
  )
}
