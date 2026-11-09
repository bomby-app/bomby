import { ChevronRight, Folder, MoreHorizontal } from "lucide-react"
import { useState } from "react"

import { Mascot } from "@/components/mascot"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { CallNameInput } from "../call/call-name"
import { useCall } from "../call/call-provider"
import type { CallSummary, Project } from "./api"
import {
  CallMenuItems,
  CONTEXT_PARTS,
  DROPDOWN_PARTS,
  type MenuParts,
} from "./call-menu"
import { callLabel, callTitle } from "./names"
import { DeleteCallDialog } from "./project-calls"
import { useProjects } from "./projects-provider"
import type { Selection } from "./selection"

type TreeProps = {
  selection: Selection
  onSelect: (selection: Selection) => void
}

/**
 * The sidebar's Projects group: each project, collapsible, with its calls under it
 * (docs/decisions/sidebar-tree-of-projects-and-calls.md). New projects come from the New
 * project row above it.
 */
export function ProjectTree({ selection, onSelect }: TreeProps) {
  const { projects } = useProjects()

  // Nothing to list yet: the New project row above and the main panel say what to do.
  if (!projects?.length) return null

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Projects</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {projects.map((project) => (
            <ProjectNode
              key={project.id}
              project={project}
              selection={selection}
              onSelect={onSelect}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function ProjectNode({
  project,
  selection,
  onSelect,
}: TreeProps & { project: Project }) {
  const { active } = useCall()
  const onCall = active?.projectId === project.id
  const holdsSelection = selection?.projectId === project.id
  // Opens whenever it gets a new selection (the project or one of its calls), also one set
  // from elsewhere: the projects home, the menu bar or a notification, even after the user
  // collapsed it. Each selection is a new object, so this compares the selection itself.
  // Adjusted during render, not in an Effect (react.dev, "Adjusting some state when a prop
  // changes").
  const [open, setOpen] = useState(holdsSelection)
  const [seen, setSeen] = useState(selection)
  if (seen !== selection) {
    setSeen(selection)
    if (holdsSelection) setOpen(true)
  }

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen}>
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive={selection?.kind === "project" && holdsSelection}
          onClick={() => onSelect({ kind: "project", projectId: project.id })}
        >
          {/* On a call, the mascot takes the folder's place. */}
          {onCall ? <Mascot state="listening" size={16} /> : <Folder />}
          <span>{project.name}</span>
        </SidebarMenuButton>
        <CollapsibleTrigger asChild>
          <SidebarMenuAction className="[&>svg]:transition-transform data-[state=open]:[&>svg]:rotate-90">
            <ChevronRight />
            <span className="sr-only">
              {open ? "Hide calls" : "Show calls"}
            </span>
          </SidebarMenuAction>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {project.calls.length === 0 ? (
              <SidebarMenuSubItem>
                <span className="block px-2 py-1 text-xs text-muted-foreground">
                  No calls yet
                </span>
              </SidebarMenuSubItem>
            ) : (
              project.calls.map((call) => (
                <CallNode
                  key={call.id}
                  projectId={project.id}
                  call={call}
                  selection={selection}
                  onSelect={onSelect}
                />
              ))
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

/**
 * A call under its project, the row's whole width: its name, cut to fit with the whole of
 * it on hover, or when it started until it has one. Its ⋯ button
 * (on hover, as in Codex's sidebar) and right-click open the same menu: Rename, which
 * turns the row into the name's field, Resume and Delete.
 */
function CallNode({
  projectId,
  call,
  selection,
  onSelect,
}: TreeProps & { projectId: number; call: CallSummary }) {
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const selected = selection?.kind === "call" && selection.callId === call.id
  const select = () => onSelect({ kind: "call", projectId, callId: call.id })

  const items = (parts: MenuParts) => (
    <CallMenuItems
      parts={parts}
      projectId={projectId}
      call={call}
      onRename={() => setRenaming(true)}
      onResume={select}
      onDelete={() => setDeleting(true)}
    />
  )
  // A closing menu leaves the focus where it is, as in Codex: handing it back to the ⋯
  // button would ring it after Esc, and Rename's field takes it anyway.
  const onCloseAutoFocus = (event: Event) => event.preventDefault()

  return (
    <SidebarMenuSubItem>
      {renaming ? (
        <CallNameInput
          call={call}
          onDone={() => setRenaming(false)}
          className="h-7 w-full"
        />
      ) : (
        <>
          <ContextMenu>
            <Tooltip>
              <ContextMenuTrigger asChild>
                <TooltipTrigger asChild>
                  <SidebarMenuSubButton
                    asChild
                    isActive={selected}
                    className={cn(
                      // The whole row, as the projects' are: a button only fits its words.
                      "w-full",
                      // Room for the ⋯ button whenever it shows.
                      "group-focus-within/menu-sub-item:pr-7 group-hover/menu-sub-item:pr-7",
                      menuOpen && "pr-7"
                    )}
                  >
                    <button type="button" onClick={select}>
                      <span>{callTitle(call)}</span>
                    </button>
                  </SidebarMenuSubButton>
                </TooltipTrigger>
              </ContextMenuTrigger>
              {/* A long name is cut to the row: the whole of it, and when it started. */}
              {call.name && (
                <TooltipContent
                  side="right"
                  className="max-w-72 flex-col items-start gap-0.5"
                >
                  {call.name}
                  <span className="text-background/70">
                    {callLabel(call.startedAt)}
                  </span>
                </TooltipContent>
              )}
            </Tooltip>
            <ContextMenuContent onCloseAutoFocus={onCloseAutoFocus}>
              {items(CONTEXT_PARTS)}
            </ContextMenuContent>
          </ContextMenu>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <SidebarMenuAction
                aria-label="Call actions"
                className="top-1 group-focus-within/menu-sub-item:opacity-100 group-hover/menu-sub-item:opacity-100 data-[state=open]:opacity-100 md:opacity-0"
              >
                <MoreHorizontal />
              </SidebarMenuAction>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="right"
              align="start"
              onCloseAutoFocus={onCloseAutoFocus}
            >
              {items(DROPDOWN_PARTS)}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      <DeleteCallDialog
        call={call}
        open={deleting}
        onOpenChange={setDeleting}
        // The page of a deleted call goes back to its project.
        onDeleted={() => {
          if (selected) onSelect({ kind: "project", projectId })
        }}
      />
    </SidebarMenuSubItem>
  )
}
