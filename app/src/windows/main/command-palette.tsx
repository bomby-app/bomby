import {
  Folder,
  FolderCog,
  ListPlus,
  MessageSquare,
  Settings,
  SquarePen,
} from "lucide-react"
import { type ReactNode, useState } from "react"

import { ShortcutKeys } from "@/components/shortcut-keys"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { useCall } from "@/features/call/call-provider"
import { callLabel } from "@/features/projects/names"
import { useProjects } from "@/features/projects/projects-provider"
import type { Selection } from "@/features/projects/selection"
import { openProjectSettings } from "@/features/projects/settings-request"
import type { CallHit } from "@/features/search/api"
import { snippetParts } from "@/features/search/snippet"
import { useSearch } from "@/features/search/use-search"
import { composeTodo } from "@/features/todos/view-state"
import {
  type ProjectPanels,
  projectPanels,
} from "@/features/workspace/panel-requests"
import type { Shortcut } from "@/lib/shortcuts"
import { useStore } from "@/lib/store"

import { openSettings, SETTINGS_SHORTCUT } from "../settings/open-settings"
import { NEW_PROJECT_SHORTCUT } from "./shortcuts"

/** Words a panel's command also answers to, beyond its name. */
const PANEL_KEYWORDS: Record<string, string[]> = {
  changes: ["git", "diff"],
  files: ["folder", "tree"],
  terminal: ["shell", "console"],
  todos: ["to-do list", "todo", "tasks"],
}

type PaletteCommand = {
  id: string
  label: string
  icon: ReactNode
  keywords?: string[]
  shortcut?: Shortcut
  run: () => void
}

/**
 * The command palette (Cmd-K, or the search button by New project): one field that finds
 * projects by name and conversations by what was said in them (the core's search), and the
 * commands for the app and the open project: New project, Add a to-do, its panels,
 * Project settings, Settings. Each command shows its shortcut, if it has one.
 */
export function CommandPalette({
  open,
  onOpenChange,
  selection,
  onSelect,
  onNewProject,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  selection: Selection
  onSelect: (selection: Selection) => void
  onNewProject: () => void
}) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Find a project or a conversation, or run a command."
      className="sm:max-w-xl"
    >
      {/* Mounted only while open, so every opening starts empty. */}
      {open && (
        <Palette
          selection={selection}
          onSelect={onSelect}
          onNewProject={onNewProject}
          onDone={() => onOpenChange(false)}
        />
      )}
    </CommandDialog>
  )
}

function Palette({
  selection,
  onSelect,
  onNewProject,
  onDone,
}: {
  selection: Selection
  onSelect: (selection: Selection) => void
  onNewProject: () => void
  onDone: () => void
}) {
  const [query, setQuery] = useState("")
  const { projects } = useProjects()
  const { active } = useCall()
  const panels = useStore(projectPanels)
  const { results, error } = useSearch(query)

  const project = projects?.find((p) => p.id === selection?.projectId)
  const commands = paletteCommands({
    project,
    panels: panels && panels.projectId === project?.id ? panels : undefined,
    // Project settings open from the project's page, which a call on it replaces.
    settingsReachable:
      project !== undefined && active?.projectId !== project.id,
    onSelect,
    onNewProject,
  }).filter((command) => matchesCommand(command, query))

  const words = query.trim()
  const foundProjects = words
    ? (results?.projects ?? [])
    : (projects ?? []).map(({ id, name }) => ({ id, name }))
  const calls = words ? (results?.calls ?? []) : []

  function run(action: () => void) {
    onDone()
    action()
  }

  return (
    <Command shouldFilter={false} loop>
      <CommandInput
        placeholder="Search projects, conversations and commands"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-[min(26rem,60vh)]">
        {/* Nothing to say until the core has answered. */}
        {(!words || results || error) && (
          <CommandEmpty className="text-muted-foreground">
            {error ?? "Nothing matches that."}
          </CommandEmpty>
        )}
        {commands.length > 0 && (
          <CommandGroup heading="Commands">
            {commands.map((command) => (
              <CommandItem
                key={command.id}
                value={`command ${command.id}`}
                onSelect={() => run(command.run)}
              >
                {command.icon}
                {command.label}
                {command.shortcut && (
                  <CommandShortcut className="tracking-normal">
                    <ShortcutKeys shortcut={command.shortcut} />
                  </CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {foundProjects.length > 0 && (
          <CommandGroup heading="Projects">
            {foundProjects.map((found) => (
              <CommandItem
                key={found.id}
                value={`project ${found.id}`}
                onSelect={() =>
                  run(() => onSelect({ kind: "project", projectId: found.id }))
                }
              >
                <Folder />
                <span className="truncate">{found.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {calls.length > 0 && (
          <CommandGroup heading="Conversations">
            {calls.map((hit) => (
              <CallItem
                key={hit.callId}
                hit={hit}
                onSelect={() =>
                  run(() =>
                    onSelect({
                      kind: "call",
                      projectId: hit.projectId,
                      callId: hit.callId,
                    })
                  )
                }
              />
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}

/** The commands there are now: the app's, and the open project's when there is one. */
function paletteCommands({
  project,
  panels,
  settingsReachable,
  onSelect,
  onNewProject,
}: {
  project: { id: number } | undefined
  panels: ProjectPanels | undefined
  settingsReachable: boolean
  onSelect: (selection: Selection) => void
  onNewProject: () => void
}): PaletteCommand[] {
  const commands: PaletteCommand[] = [
    {
      id: "new-project",
      label: "New project",
      icon: <SquarePen />,
      shortcut: NEW_PROJECT_SHORTCUT,
      run: onNewProject,
    },
  ]
  if (project && panels?.sections.some((panel) => panel.id === "todos")) {
    commands.push({
      id: "add-todo",
      label: "Add a to-do",
      icon: <ListPlus />,
      keywords: ["new to-do", "todo", "task"],
      run: () => {
        composeTodo(project.id)
        panels.show("todos")
      },
    })
  }
  if (panels) {
    for (const panel of panels.sections) {
      commands.push({
        id: `panel ${panel.id}`,
        label: panel.label,
        icon: panel.icon,
        keywords: PANEL_KEYWORDS[panel.id],
        shortcut: panel.shortcut,
        run: () => panels.show(panel.id),
      })
    }
  }
  if (project && settingsReachable) {
    commands.push({
      id: "project-settings",
      label: "Project settings",
      icon: <FolderCog />,
      keywords: ["folders", "instructions", "agents", "extensions"],
      run: () => {
        onSelect({ kind: "project", projectId: project.id })
        openProjectSettings(project.id)
      },
    })
  }
  commands.push({
    id: "settings",
    label: "Settings",
    icon: <Settings />,
    keywords: ["preferences", "voice", "keys"],
    shortcut: SETTINGS_SHORTCUT,
    run: () => void openSettings(),
  })
  return commands
}

/** Every word of the query is in the command's name or keywords; all of them for none. */
function matchesCommand(command: PaletteCommand, query: string): boolean {
  const text = [command.label, ...(command.keywords ?? [])]
    .join(" ")
    .toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word))
}

/** A conversation that matched: its project and when, and the line, matches marked. */
function CallItem({ hit, onSelect }: { hit: CallHit; onSelect: () => void }) {
  return (
    <CommandItem
      value={`call ${hit.callId}`}
      onSelect={onSelect}
      className="items-start"
    >
      <MessageSquare className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate font-medium">{hit.projectName}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {callLabel(hit.startedAt)}
          </span>
        </span>
        <span className="line-clamp-2 text-xs/5 break-words text-muted-foreground">
          {hit.role === "agent" ? "Bomby: " : "You: "}
          {snippetParts(hit.snippet).map((part, index) =>
            part.match ? (
              <mark
                key={`${index} ${part.text}`}
                className="rounded-[2px] bg-highlighter px-px text-highlighter-foreground"
              >
                {part.text}
              </mark>
            ) : (
              <span key={`${index} ${part.text}`}>{part.text}</span>
            )
          )}
        </span>
      </div>
      {hit.matches > 1 && (
        <CommandShortcut className="tracking-normal tabular-nums">
          {hit.matches} lines
        </CommandShortcut>
      )}
    </CommandItem>
  )
}
