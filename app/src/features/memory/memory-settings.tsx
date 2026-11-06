import { openUrl } from "@tauri-apps/plugin-opener"
import { Brain, EyeOff, Info } from "lucide-react"
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"

import { InlineLink } from "@/components/inline-link"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ZepLogo } from "@/features/setup/provider-logos"

import {
  clearZepKey,
  hasZepKey,
  type Memory,
  memoryIncognito,
  memorySetting,
  saveZepKey,
  setMemoryIncognito,
  setMemorySetting,
} from "./api"

const ZEP_KEYS = "https://app.getzep.com"

/**
 * The Memory section of the settings window: whether Bomby remembers the user across calls,
 * in their own Zep project (docs/decisions/memory-across-calls-with-zep.md).
 */
export function MemorySettings() {
  const [saved, setSaved] = useState<Saved | null>(null)
  // Saves run one after another, in click order, so a quick off and on can't land swapped.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const waiting = useRef(0)
  const failed = useRef(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([memorySetting(), memoryIncognito(), hasZepKey()]).then(
      ([memory, incognito, keySaved]) =>
        setSaved({ memory, incognito, keySaved }),
      (e: unknown) => setError(String(e))
    )
  }, [])

  function change(next: Partial<Saved>, write: () => Promise<void>) {
    setError(null)
    setSaved((now) => now && { ...now, ...next })
    waiting.current += 1
    queue.current = queue.current
      .then(write)
      .catch((e: unknown) => {
        failed.current = true
        setError(String(e))
      })
      .then(async () => {
        waiting.current -= 1
        if (waiting.current > 0 || !failed.current) return
        // A save failed: once none is left to run, show what the core has.
        failed.current = false
        try {
          const [memory, incognito] = await Promise.all([
            memorySetting(),
            memoryIncognito(),
          ])
          if (waiting.current > 0) failed.current = true
          else setSaved((now) => now && { ...now, memory, incognito })
        } catch {
          // The error above already shows.
        }
      })
  }

  if (!saved) {
    return error ? <FieldError>{error}</FieldError> : null
  }
  const on = saved.memory === "zep"

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border bg-card">
        <div className="flex items-center gap-3 p-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
            <Brain className="size-[18px]" />
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <FieldLabel htmlFor="memory">Remember me across calls</FieldLabel>
            <InfoTip>
              I keep what I learn about you and your work, and use it next time.
              Resuming a call picks up its last lines either way.
            </InfoTip>
          </div>
          <Switch
            id="memory"
            checked={on}
            onCheckedChange={(checked) => {
              const memory: Memory = checked ? "zep" : "off"
              change({ memory }, () => setMemorySetting(memory))
            }}
          />
        </div>

        {on && (
          <>
            <Separator />
            <div className="flex items-center gap-3 p-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                <EyeOff className="size-[18px]" />
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-1">
                <FieldLabel htmlFor="memory-incognito">Incognito</FieldLabel>
                <InfoTip>
                  I still use what I remember, but save nothing from your calls.
                  Applies from the next call.
                </InfoTip>
              </div>
              <Switch
                id="memory-incognito"
                checked={saved.incognito}
                onCheckedChange={(incognito) =>
                  change({ incognito }, () => setMemoryIncognito(incognito))
                }
              />
            </div>
            <Separator />
            <div className="p-4">
              <FieldSet className="gap-4">
                <FieldLegend className="mb-0 flex items-center gap-2">
                  <ZepLogo className="size-4" />
                  Zep
                  <InfoTip>
                    Memory lives in your own Zep project; the free plan is
                    enough.
                  </InfoTip>
                </FieldLegend>
                <ZepKeyForm
                  saved={saved.keySaved}
                  onChange={(keySaved) =>
                    setSaved((now) => now && { ...now, keySaved })
                  }
                />
              </FieldSet>
            </div>
          </>
        )}
      </div>
      {error && <FieldError>{error}</FieldError>}
    </div>
  )
}

/** What the core has saved. */
type Saved = { memory: Memory; incognito: boolean; keySaved: boolean }

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "removing" }
  | { kind: "saved" }
  | { kind: "error"; message: string }

/** The Zep API key. Write-only: the page never sees it again. */
function ZepKeyForm({
  saved,
  onChange,
}: {
  saved: boolean
  onChange: (saved: boolean) => void
}) {
  const [key, setKey] = useState("")
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  // Save and Remove never overlap.
  const busy = status.kind === "saving" || status.kind === "removing"

  async function save(event: FormEvent) {
    event.preventDefault()
    setStatus({ kind: "saving" })
    try {
      await saveZepKey(key)
      setKey("")
      onChange(true)
      setStatus({ kind: "saved" })
    } catch (e) {
      setStatus({ kind: "error", message: String(e) })
    }
  }

  async function remove() {
    setStatus({ kind: "removing" })
    try {
      await clearZepKey()
      onChange(false)
      setStatus({ kind: "idle" })
    } catch (e) {
      setStatus({ kind: "error", message: String(e) })
    }
  }

  return (
    <form onSubmit={save}>
      <FieldGroup>
        <Field>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="zep-api-key">API key</FieldLabel>
            <InlineLink
              className="text-sm"
              onClick={() => void openUrl(ZEP_KEYS)}
            >
              Get an API key
            </InlineLink>
          </div>
          <Input
            id="zep-api-key"
            type="password"
            placeholder={saved ? "Saved. Type a new one to replace it." : ""}
            value={key}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setKey(event.target.value)
              if (!busy) setStatus({ kind: "idle" })
            }}
          />
          {!saved && (
            <FieldDescription>Add a key to start remembering.</FieldDescription>
          )}
        </Field>
        {status.kind === "error" && <FieldError>{status.message}</FieldError>}
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={busy || !key.trim()}>
            {status.kind === "saving" ? "Saving..." : "Save"}
          </Button>
          {saved && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={remove}
            >
              Remove
            </Button>
          )}
          {status.kind === "saved" && (
            <span className="text-sm text-muted-foreground">Saved</span>
          )}
        </div>
      </FieldGroup>
    </form>
  )
}

/** The (i) beside a line, its explanation in a tooltip. */
function InfoTip({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="More about this"
        >
          <Info />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{children}</TooltipContent>
    </Tooltip>
  )
}
