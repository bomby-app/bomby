import { LoaderCircle, ThumbsUp, X } from "lucide-react"
import { type ReactNode, useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { type ClaudeStatus, claudeStatus, planName } from "../claude/api"
import { credentialsInfo, hasGeminiKey } from "../credentials/api"

type Checks = {
  livekit: boolean
  gemini: boolean
  claude: ClaudeStatus
}

/**
 * The Setup section of the settings window: the three things a call needs, each ready or
 * missing, with what to do about it (docs/decisions/users-bring-their-own-keys-and-claude.md).
 */
export function SetupSettings() {
  const [checks, setChecks] = useState<Checks | null>(null)
  const [error, setError] = useState<string | null>(null)

  const check = useCallback(async () => {
    setChecks(null)
    setError(null)
    try {
      const [livekit, gemini, claude] = await Promise.all([
        credentialsInfo(),
        hasGeminiKey(),
        claudeStatus(),
      ])
      setChecks({ livekit: !!livekit?.hasSecret, gemini, claude })
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
        A call needs these three. Claudible uses your own accounts.
      </p>
      <ul className="flex flex-col divide-y rounded-lg border">
        <Requirement
          name="LiveKit keys"
          ready={checks?.livekit}
          detail={
            checks?.livekit
              ? "Saved in your keychain."
              : "Add them in Credentials."
          }
        />
        <Requirement
          name="Gemini API key"
          ready={checks?.gemini}
          detail={
            checks?.gemini
              ? "Saved in your keychain."
              : "Add it in Credentials."
          }
        />
        <Requirement
          name="Claude Code"
          ready={checks?.claude.signedIn}
          detail={checks && claudeDetail(checks.claude)}
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

function claudeDetail({
  path,
  version,
  signedIn,
  plan,
}: ClaudeStatus): ReactNode {
  if (!path) return "Not found. Install Claude Code, then check again."
  if (!signedIn)
    return (
      <>
        Not signed in. Run{" "}
        <code className="font-mono text-xs select-text">claude auth login</code>{" "}
        in Terminal, then check again.
      </>
    )
  const account = plan ? `Signed in, ${planName(plan)}` : "Signed in"
  return version
    ? `${account} · ${version.replace(" (Claude Code)", "")}`
    : account
}

/** One row. `ready` undefined or null means still checking. */
function Requirement({
  name,
  ready,
  detail,
}: {
  name: string
  ready: boolean | null | undefined
  detail: ReactNode
}) {
  const checking = ready === undefined || ready === null
  return (
    <li className="flex items-center gap-3 px-3 py-3">
      <StatusMark state={checking ? "checking" : ready ? "ready" : "missing"} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{name}</span>
        <span className="text-sm text-muted-foreground">
          {checking ? "Checking..." : detail}
        </span>
      </div>
    </li>
  )
}

/**
 * Ready is an ink thumbs-up on a highlighter disc, missing an ink cross on bubblegum (the
 * brand's colour for problems). Both fills hold ink at full contrast in light and dark.
 */
function StatusMark({ state }: { state: "checking" | "ready" | "missing" }) {
  if (state === "checking") {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center">
        <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
      </span>
    )
  }
  return (
    <span
      className={
        state === "ready"
          ? "flex size-6 shrink-0 items-center justify-center rounded-full bg-highlighter text-highlighter-foreground"
          : "flex size-6 shrink-0 items-center justify-center rounded-full bg-claude text-claude-foreground"
      }
    >
      {state === "ready" ? (
        <ThumbsUp className="size-3.5" strokeWidth={2.25} />
      ) : (
        <X className="size-3.5" strokeWidth={2.5} />
      )}
      <span className="sr-only">{state === "ready" ? "Ready" : "Missing"}</span>
    </span>
  )
}
