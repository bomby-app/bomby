import { ChevronRight, Folder } from "lucide-react"
import { useState } from "react"

import { Mascot } from "@/components/mascot"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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

import { useCall } from "../call/call-provider"
import type { Project } from "./api"
import { callLabel } from "./names"
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
                <SidebarMenuSubItem key={call.id}>
                  <SidebarMenuSubButton
                    asChild
                    isActive={
                      selection?.kind === "call" && selection.callId === call.id
                    }
                  >
                    <button
                      type="button"
                      onClick={() =>
                        onSelect({
                          kind: "call",
                          projectId: project.id,
                          callId: call.id,
                        })
                      }
                    >
                      <span>{callLabel(call.startedAt)}</span>
                    </button>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}
