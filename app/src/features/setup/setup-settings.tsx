import { useCallback, useEffect, useState } from "react"

import { StatusRow } from "@/components/status-row"
import { Button } from "@/components/ui/button"
import { credentialsInfo, hasGeminiKey } from "../credentials/api"
import { GeminiLogo, LiveKitLogo } from "./provider-logos"

type Checks = {
  livekit: boolean
  gemini: boolean
}

/**
 * The Setup section of the settings window: the keys a call needs, each ready or missing,
 * with what to do about it (docs/decisions/users-bring-their-own-keys-and-claude.md). The
 * agents that do the work have their own section.
 */
export function SetupSettings() {
  const [checks, setChecks] = useState<Checks | null>(null)
  const [error, setError] = useState<string | null>(null)

  const check = useCallback(async () => {
    setChecks(null)
    setError(null)
    try {
      const [livekit, gemini] = await Promise.all([
        credentialsInfo(),
        hasGeminiKey(),
      ])
      setChecks({ livekit: !!livekit?.hasSecret, gemini })
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => {
    void check()
  }, [check])

  if (error) return <p className="text-sm text-destructive">{error}</p>

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        A call needs these two and an agent from Agents. Bomby uses your own
        accounts.
      </p>
      <ul className="flex flex-col divide-y rounded-lg border">
        <StatusRow
          logo={<LiveKitLogo />}
          name="LiveKit keys"
          ready={checks?.livekit}
          detail={
            checks?.livekit
              ? "Saved in your keychain."
              : "Add them in Credentials."
          }
        />
        <StatusRow
          logo={<GeminiLogo />}
          name="Gemini API key"
          ready={checks?.gemini}
          detail={
            checks?.gemini
              ? "Saved in your keychain."
              : "Add it in Credentials."
          }
        />
      </ul>
      <div>
        <Button
          variant="outline"
          disabled={!checks}
          onClick={() => void check()}
        >
          Check again
        </Button>
      </div>
    </div>
  )
}
