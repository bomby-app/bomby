import { ArrowUpToLine, FolderPlus, X } from "lucide-react"
import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { pickFolders } from "./api"

/**
 * A project's folders, in order: the first is Claude's working folder. Add opens the system
 * folder picker; rows can be removed or moved to the top. Used by the New project dialog
 * and the project view.
 */
export function FolderList({
  folders,
  onChange,
  minimum = 1,
}: {
  folders: string[]
  onChange: (folders: string[]) => void
  /** Rows can't be removed below this many. */
  minimum?: number
}) {
  async function add() {
    const picked = await pickFolders("Add folders Claude can work in")
    const fresh = picked.filter((f) => !folders.includes(f))
    if (fresh.length > 0) onChange([...folders, ...fresh])
  }

  const canRemove = folders.length > minimum

  return (
    <div className="flex flex-col gap-3">
      {folders.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border">
          {folders.map((folder, index) => (
            <li
              key={folder}
              className="flex min-h-11 items-center gap-2 py-1.5 pr-1.5 pl-3"
            >
              <span
                title={folder}
                className="min-w-0 flex-1 truncate text-sm select-text"
              >
                {folder}
              </span>
              {index === 0 ? (
                <Badge variant="secondary">Working folder</Badge>
              ) : (
                <IconAction
                  label="Make it the working folder"
                  onClick={() =>
                    onChange([folder, ...folders.filter((_, i) => i !== index)])
                  }
                >
                  <ArrowUpToLine />
                </IconAction>
              )}
              <IconAction
                label={
                  canRemove
                    ? "Remove from the project"
                    : "A project needs a folder"
                }
                disabled={!canRemove}
                onClick={() => onChange(folders.filter((_, i) => i !== index))}
              >
                <X />
              </IconAction>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button type="button" variant="outline" onClick={() => void add()}>
          <FolderPlus />
          {folders.length === 0 ? "Choose folders" : "Add folders"}
        </Button>
      </div>
    </div>
  )
}

function IconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
