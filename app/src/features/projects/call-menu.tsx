import { Pencil, Play, Trash2 } from "lucide-react"
import type { ComponentType, ReactNode } from "react"

import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu"
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"

import { useCall } from "../call/call-provider"
import type { CallSummary } from "./api"
import { useResume } from "./project-calls"

type ItemProps = {
  onSelect: () => void
  disabled?: boolean
  variant?: "default" | "destructive"
  children: ReactNode
}

/** The parts a menu is made of: a dropdown's (the ⋯ button) or a context menu's (right-click). */
export type MenuParts = {
  Item: ComponentType<ItemProps>
  Separator: ComponentType
}

export const DROPDOWN_PARTS: MenuParts = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
}

export const CONTEXT_PARTS: MenuParts = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
}

/**
 * What can be done to a call from a menu: Rename, Resume and Delete, the same in its ⋯
 * menu and on right-click. Renaming and deleting are the caller's to show (the row's
 * field, the delete dialog); resuming starts the call here.
 */
export function CallMenuItems({
  parts: { Item, Separator },
  projectId,
  call,
  onRename,
  onResume,
  onDelete,
}: {
  parts: MenuParts
  projectId: number
  call: CallSummary
  onRename: () => void
  /** Before the call resumes: to show it, say. */
  onResume?: () => void
  onDelete: () => void
}) {
  const { active } = useCall()
  const { can, resume } = useResume(projectId, call.id)
  return (
    <>
      <Item onSelect={onRename}>
        <Pencil />
        Rename
      </Item>
      <Item
        disabled={!can}
        onSelect={() => {
          onResume?.()
          resume()
        }}
      >
        <Play />
        Resume
      </Item>
      <Separator />
      <Item
        variant="destructive"
        disabled={active?.callId === call.id}
        onSelect={onDelete}
      >
        <Trash2 />
        Delete
      </Item>
    </>
  )
}
