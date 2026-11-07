import { Fragment, useRef, useState } from "react"

import { FieldError, FieldLabel } from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"

import { setExtension } from "./api"
import { ExtensionIcon } from "./extension-icon"
import { setExtensions, useExtensions } from "./use-extensions"

/**
 * The Extensions section of the settings window (Paper "extensions", 01): each extension
 * Bomby has, on or off for every project that follows Settings
 * (docs/decisions/extensions.md). Applies from the next call.
 */
export function ExtensionsSettings() {
  const extensions = useExtensions()
  const [error, setError] = useState<string | null>(null)
  // Saves run one after another, in click order, so a quick off and on can't land swapped.
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  function toggle(id: string, on: boolean) {
    setError(null)
    if (extensions) {
      setExtensions(extensions.map((e) => (e.id === id ? { ...e, on } : e)))
    }
    queue.current = queue.current
      .then(() => setExtension(id, on))
      .then(setExtensions, (e: unknown) => setError(String(e)))
  }

  if (!extensions) return null

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Tools Bomby can use on your calls. Every project uses these unless you
        change it in its settings. Your next call picks up a change.
      </p>
      <div className="rounded-lg border bg-card">
        {extensions.map((extension, index) => (
          <Fragment key={extension.id}>
            {index > 0 && <Separator />}
            <div className="flex items-center gap-3 px-4 py-3.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                <ExtensionIcon id={extension.id} className="size-[18px]" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
                <FieldLabel htmlFor={`extension-${extension.id}`}>
                  {extension.name}
                </FieldLabel>
                <span className="text-muted-foreground">
                  {extension.description}
                </span>
              </div>
              <Switch
                id={`extension-${extension.id}`}
                checked={extension.on}
                onCheckedChange={(on) => toggle(extension.id, on)}
              />
            </div>
          </Fragment>
        ))}
      </div>
      {error && <FieldError>{error}</FieldError>}
      <p className="text-sm text-muted-foreground">
        More extensions are on the way.
      </p>
    </div>
  )
}
