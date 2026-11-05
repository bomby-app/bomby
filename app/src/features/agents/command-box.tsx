import { CopyButton } from "./copy-button"

/** A command to run in Terminal, selectable, with a button that copies it. */
export function CommandBox({ command }: { command: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted py-1.5 pr-1.5 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-xs select-text">
        {command}
      </code>
      <CopyButton text={command} variant="ghost" size="icon-sm" />
    </div>
  )
}
