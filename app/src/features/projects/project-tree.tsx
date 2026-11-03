import { ChevronRight, Folder } from "lucide-react"
import { useState } from "react"

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
  const holdsSelection = selection?.projectId === project.id
  // Starts open when it holds the selection (the project or one of its calls).
  const [open, setOpen] = useState(holdsSelection)

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      render={<SidebarMenuItem />}
    >
      <SidebarMenuButton
        isActive={selection?.kind === "project" && holdsSelection}
        onClick={() => {
          onSelect({ kind: "project", projectId: project.id })
          setOpen(true)
        }}
      >
        <Folder />
        <span>{project.name}</span>
      </SidebarMenuButton>
      <CollapsibleTrigger
        render={
          <SidebarMenuAction className="data-panel-open:[&>svg]:rotate-90 [&>svg]:transition-transform" />
        }
      >
        <ChevronRight />
        <span className="sr-only">{open ? "Hide calls" : "Show calls"}</span>
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
                  render={<button type="button" />}
                  isActive={
                    selection?.kind === "call" && selection.callId === call.id
                  }
                  onClick={() =>
                    onSelect({
                      kind: "call",
                      projectId: project.id,
                      callId: call.id,
                    })
                  }
                >
                  <span>{callLabel(call.startedAt)}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))
          )}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  )
}
