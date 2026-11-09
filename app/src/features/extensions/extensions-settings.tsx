import { Fragment, useRef, useState } from "react"

import { ExperimentalBadge } from "@/components/experimental-badge"
import { FieldError, FieldLabel } from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"

import { setExtension } from "./api"
import { ExtensionConnection } from "./extension-connection"
import { ExtensionIcon } from "./extension-icon"
import { setExtensions, useExtensions } from "./use-extensions"

/** Still settling in Bomby: marked Experimental. */
const EXPERIMENTAL = new Set(["zapier", "composio"])

/**
 * The Extensions section of the settings window (Paper "extensions", 01): each extension
 * Bomby has, on or off for every project that follows Settings
 * (docs/decisions/extensions.md). Applies from the next call. One that signs in (Zapier,
 * Composio) opens its own settings under its row while it's on or connected, the way
 * Settings, Voice opens a provider's key under it.
 */
export function ExtensionsSettings() {
  const confirmed = useExtensions()
  const [error, setError] = useState<string | null>(null)
  // What the user switched and the core hasn't yet confirmed, shown over what it has. The
  // store only ever holds the core's answers, so a failed save shows what's really saved.
  const [pending, setPending] = useState<Record<string, boolean>>({})
  // Saves run one after another, in click order, so a quick off and on can't land swapped.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  // Each extension's newest switch: only it clears the pending value, never an older save.
  const latest = useRef(new Map<string, number>())

  function toggle(id: string, on: boolean) {
    setError(null)
    setPending((now) => ({ ...now, [id]: on }))
    const switched = (latest.current.get(id) ?? 0) + 1
    latest.current.set(id, switched)
    queue.current = queue.current
      .then(() => setExtension(id, on))
      .then(setExtensions, (e: unknown) => setError(String(e)))
      .finally(() => {
        if (latest.current.get(id) !== switched) return
        setPending((now) =>
          Object.fromEntries(Object.entries(now).filter(([key]) => key !== id))
        )
      })
  }

  if (!confirmed) return null
  const extensions = confirmed.map((e) => ({ ...e, on: pending[e.id] ?? e.on }))

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
                <span className="flex items-center gap-2">
                  <FieldLabel htmlFor={`extension-${extension.id}`}>
                    {extension.name}
                  </FieldLabel>
                  {EXPERIMENTAL.has(extension.id) && <ExperimentalBadge />}
                </span>
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
            {extension.connection &&
              (extension.on ||
                extension.connection.connected ||
                extension.connection.connecting) && (
                // Lined up with the title: the row's padding, the tile and the gap.
                <div className="flex flex-col gap-3 pt-1 pr-4 pb-4 pl-16">
                  <ExtensionConnection extension={extension} />
                </div>
              )}
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
