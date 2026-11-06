import { openUrl } from "@tauri-apps/plugin-opener"
import { Brain, EyeOff, Info } from "lucide-react"
import { type FormEvent, type ReactNode, useEffect, useState } from "react"

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
  const [memory, setMemory] = useState<Memory | null>(null)
  const [keySaved, setKeySaved] = useState<boolean | null>(null)
  const [incognito, setIncognito] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    memorySetting().then(setMemory, (e: unknown) => setError(String(e)))
    hasZepKey().then(setKeySaved, (e: unknown) => setError(String(e)))
    memoryIncognito().then(setIncognito, (e: unknown) => setError(String(e)))
  }, [])

  async function chooseIncognito(on: boolean) {
    const previous = incognito
    setError(null)
    setIncognito(on)
    try {
      await setMemoryIncognito(on)
    } catch (e) {
      setIncognito(previous)
      setError(String(e))
    }
  }

  async function choose(on: boolean) {
    const previous = memory
    const next: Memory = on ? "zep" : "off"
    setError(null)
    setMemory(next)
    try {
      await setMemorySetting(next)
    } catch (e) {
      setMemory(previous)
      setError(String(e))
    }
  }

  const on = memory === "zep"

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
            disabled={memory === null}
            onCheckedChange={(checked) => void choose(checked)}
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
                checked={incognito === true}
                disabled={incognito === null}
                onCheckedChange={(checked) => void chooseIncognito(checked)}
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
                <ZepKeyForm saved={keySaved} onChange={setKeySaved} />
              </FieldSet>
            </div>
          </>
        )}
      </div>
      {error && <FieldError>{error}</FieldError>}
    </div>
  )
}

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string }

/** The Zep API key. Write-only: the page never sees it again. */
function ZepKeyForm({
  saved,
  onChange,
}: {
  /** Null until the core has said. */
  saved: boolean | null
  onChange: (saved: boolean) => void
}) {
  const [key, setKey] = useState("")
  const [status, setStatus] = useState<Status>({ kind: "idle" })

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
            placeholder={
              saved === true ? "Saved. Type a new one to replace it." : ""
            }
            value={key}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setKey(event.target.value)
              if (status.kind !== "saving") setStatus({ kind: "idle" })
            }}
          />
          {saved === false && (
            <FieldDescription>Add a key to start remembering.</FieldDescription>
          )}
        </Field>
        {status.kind === "error" && <FieldError>{status.message}</FieldError>}
        <div className="flex items-center gap-2">
          <Button
            type="submit"
            disabled={status.kind === "saving" || !key.trim()}
          >
            {status.kind === "saving" ? "Saving..." : "Save"}
          </Button>
          {saved === true && (
            <Button type="button" variant="ghost" onClick={remove}>
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
