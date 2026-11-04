import { readText } from "@tauri-apps/plugin-clipboard-manager"
import { openUrl } from "@tauri-apps/plugin-opener"
import { ClipboardPaste } from "lucide-react"
import { useActionState, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { saveCredentials, saveGeminiKey } from "@/features/credentials/api"
import { GeminiForm } from "@/features/credentials/gemini-form"
import { parseLiveKitEnv } from "@/features/credentials/livekit-env"
import { LiveKitForm } from "@/features/credentials/livekit-form"
import { checkKeysAgain } from "@/features/credentials/use-saved-keys"
import { GeminiLogo, LiveKitLogo } from "@/features/setup/provider-logos"
import { cn } from "@/lib/utils"

import {
  CARD_BUTTON,
  SetupCard,
  StatusLine,
  StepHeading,
  Tile,
} from "./setup-card"

const LIVEKIT_KEYS = "https://cloud.livekit.io"
const GEMINI_KEYS = "https://aistudio.google.com/apikey"

/** A Gemini API key: one token, no spaces ("AIza..." today). */
const GEMINI_KEY = /^\S{20,}$/

/** Fills all three LiveKit values from the Environment variables box on the clipboard. */
async function pasteLiveKit(): Promise<string | null> {
  const env = parseLiveKitEnv((await readText().catch(() => "")) ?? "")
  if (!env)
    return "Copy the Environment variables box from LiveKit Cloud, then paste again."
  try {
    await saveCredentials(env)
  } catch (e) {
    return String(e)
  }
  await checkKeysAgain()
  return null
}

async function pasteGemini(): Promise<string | null> {
  const key = ((await readText().catch(() => "")) ?? "").trim()
  if (!GEMINI_KEY.test(key))
    return "Copy your API key from Google AI Studio, then paste again."
  try {
    await saveGeminiKey(key)
  } catch (e) {
    return String(e)
  }
  await checkKeysAgain()
  return null
}

/**
 * The splash's second step: the LiveKit and Gemini keys a call talks through, the user's
 * own (docs/decisions/users-bring-their-own-keys-and-claude.md). Each pastes from the
 * clipboard in one click; typing them is a dialog away.
 */
export function KeysStep({
  keys,
}: {
  keys: { livekit: boolean; gemini: boolean }
}) {
  const [livekitError, pasteLiveKitNow, pastingLiveKit] = useActionState(
    pasteLiveKit,
    null
  )
  const [geminiError, pasteGeminiNow, pastingGemini] = useActionState(
    pasteGemini,
    null
  )
  const [typing, setTyping] = useState(false)
  const error = livekitError ?? geminiError

  return (
    <div className="flex flex-col items-center">
      <StepHeading
        title="Just one more step"
        body="I talk through your own LiveKit and Gemini, so nothing goes through us. Paste your keys and we're ready."
      />

      <SetupCard
        className="mt-7"
        tile={
          <Tile>
            <LiveKitLogo />
          </Tile>
        }
        name="LiveKit"
        status={
          <StatusLine
            tone={keys.livekit ? "done" : "todo"}
            text={keys.livekit ? "Saved in your keychain" : "Not added yet"}
          />
        }
        action={
          !keys.livekit && (
            <form action={pasteLiveKitNow}>
              <Button
                type="submit"
                disabled={pastingLiveKit}
                className={CARD_BUTTON}
              >
                <ClipboardPaste />
                Paste all
              </Button>
            </form>
          )
        }
      />
      <SetupCard
        className="mt-3"
        tile={
          <Tile>
            <GeminiLogo />
          </Tile>
        }
        name="Gemini"
        status={
          <StatusLine
            tone={keys.gemini ? "done" : "todo"}
            text={keys.gemini ? "Saved in your keychain" : "Not added yet"}
          />
        }
        action={
          !keys.gemini && (
            <form action={pasteGeminiNow}>
              <Button
                type="submit"
                disabled={pastingGemini}
                className={CARD_BUTTON}
              >
                <ClipboardPaste />
                Paste key
              </Button>
            </form>
          )
        }
      />

      <p
        className={cn(
          "mt-7 w-[440px] text-center text-[13px] leading-[18px]",
          error ? "text-destructive" : "text-foreground/55"
        )}
      >
        {error ?? (
          <>
            Copy them from <Link href={LIVEKIT_KEYS}>LiveKit Cloud</Link>{" "}
            (Settings, API keys) and{" "}
            <Link href={GEMINI_KEYS}>Google AI Studio</Link>, or{" "}
            <button
              type="button"
              className="font-medium text-foreground underline decoration-highlighter decoration-[3px] underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setTyping(true)}
            >
              type them in
            </button>
            .
          </>
        )}
      </p>

      <Dialog open={typing} onOpenChange={setTyping}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Your keys</DialogTitle>
            <DialogDescription>
              Kept in your Mac's keychain, never sent anywhere else.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-8">
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-medium">LiveKit</h2>
              <LiveKitForm />
            </section>
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-medium">Gemini</h2>
              <GeminiForm />
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Opens a page in the browser, in the app's link style (ink, highlighter underline). */
function Link({ href, children }: { href: string; children: string }) {
  return (
    <button
      type="button"
      className="font-medium text-foreground underline decoration-highlighter decoration-[3px] underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => void openUrl(href)}
    >
      {children}
    </button>
  )
}
