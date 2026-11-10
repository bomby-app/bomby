import { Blocks } from "lucide-react"

import { FieldLabel } from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { andList } from "@/lib/text"

import type { ProjectExtensions } from "./api"
import { ExtensionIcon } from "./extension-icon"
import { isOn, useExtensions } from "./use-extensions"

type Mode = "settings" | "own"

/**
 * Which extensions a project's calls have (Paper "extensions", 02): the same as Settings,
 * or the project's own pick, one switch per extension beside what Settings has. Picking
 * starts from the project's last picks, even none, or Settings' if it never picked.
 * Applies from the next call.
 */
export function ProjectExtensionsField({
  extensions: chosen,
  onChange,
}: {
  extensions: ProjectExtensions
  onChange: (extensions: ProjectExtensions) => void
}) {
  const settings = useExtensions()
  if (!settings || settings.length === 0) return null

  function setMode(mode: Mode) {
    if (mode === "settings") {
      onChange({ ...chosen, own: false })
      return
    }
    const on =
      chosen.on ?? (settings ?? []).filter((e) => e.on).map((e) => e.id)
    onChange({ own: true, on })
  }

  function toggle(id: string, on: boolean) {
    const others = (chosen.on ?? []).filter((e) => e !== id)
    onChange({ own: true, on: on ? [...others, id] : others })
  }

  // One that signs in reaches a call only once it's connected.
  const names = settings
    .filter((e) => isOn(e.id, chosen, settings))
    .filter((e) => !e.connection || e.connection.connected)
    .map((e) => e.name)
  const summary =
    names.length === 0
      ? "This project's calls have no extensions."
      : `This project's calls have ${andList(names)}.`

  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
          <Blocks className="size-[18px]" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
          <FieldLabel>Extensions</FieldLabel>
          <span className="text-muted-foreground">
            What Bomby can use on this project&apos;s calls.
          </span>
        </div>
      </div>
      <Separator />
      <div className="flex flex-col gap-3 p-4">
        <ToggleGroup
          type="single"
          aria-label="Extensions"
          value={chosen.own ? "own" : "settings"}
          // A single toggle group lets its item be clicked off; one is always chosen.
          onValueChange={(mode) => mode && setMode(mode as Mode)}
          spacing={0}
          className="w-full gap-[3px] bg-muted p-[3px]"
        >
          {(
            [
              ["settings", "Same as Settings"],
              ["own", "Choose for this project"],
            ] as const
          ).map(([mode, label]) => (
            <ToggleGroupItem
              key={mode}
              value={mode}
              className="h-7 flex-1 rounded-md! text-sm font-medium text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs"
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {chosen.own &&
          settings.map((extension) => (
            <div
              key={extension.id}
              className="flex h-11 items-center gap-3 rounded-lg border px-3"
            >
              <ExtensionIcon id={extension.id} className="size-4 shrink-0" />
              <FieldLabel
                htmlFor={`project-extension-${extension.id}`}
                className="flex-1"
              >
                {extension.name}
              </FieldLabel>
              <span className="font-mono text-xs text-muted-foreground">
                {extension.connection && !extension.connection.connected
                  ? "Not connected"
                  : extension.on
                    ? "On in Settings"
                    : "Off in Settings"}
              </span>
              <Switch
                id={`project-extension-${extension.id}`}
                checked={chosen.on?.includes(extension.id) ?? false}
                onCheckedChange={(on) => toggle(extension.id, on)}
              />
            </div>
          ))}
        <p className="text-sm text-muted-foreground">{summary}</p>
      </div>
    </div>
  )
}
