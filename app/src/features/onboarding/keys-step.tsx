import { readText } from "@tauri-apps/plugin-clipboard-manager"
import { openUrl } from "@tauri-apps/plugin-opener"
import { ClipboardPaste } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useActionState, useState } from "react"

import { InlineLink } from "@/components/inline-link"
import { Button } from "@/components/ui/button"
import { saveCredentials, saveGeminiKey } from "@/features/credentials/api"
import { parseLiveKitEnv } from "@/features/credentials/livekit-env"
import {
  checkKeysAgain,
  chooseLiveKitServer,
  useSavedKeys,
  type Keys,
} from "@/features/credentials/use-saved-keys"
import { GeminiLogo, LiveKitLogo } from "@/features/setup/provider-logos"
import { cn } from "@/lib/utils"

import { KeysDialog } from "./keys-dialog"
import {
  CARD_BUTTON,
  SetupCard,
  StatusLine,
  StepHeading,
  Tile,
} from "./setup-card"

const LIVEKIT_KEYS = "https://cloud.livekit.io"
const GEMINI_KEYS = "https://aistudio.google.com/apikey"

/** One width, so the paste buttons line up. */
const PASTE_BUTTON = cn(CARD_BUTTON, "w-32")

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
 * clipboard in one click; typing them is a dialog away. After Set up later there's no agent
 * yet: the step says a call can still talk, and offers the way back to set one up.
 */
export function KeysStep({
  keys,
  allSet,
  withoutAgent,
  onSetUpAgent,
}: {
  keys: Keys
  allSet: boolean
  /** The user went on without an agent (Set up later). */
  withoutAgent: boolean
  onSetUpAgent: () => void
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
  // A failed Local or Cloud switch lands in the store, not in this step's state.
  const { error: keysError } = useSavedKeys()
  const error = livekitError ?? geminiError ?? keysError
  const cloud = keys.server === "theirs"

  return (
    <div className="flex flex-col items-center">
      <StepHeading
        title={
          allSet
            ? "You're all set"
            : withoutAgent
              ? "Let's still talk"
              : "Just one more step"
        }
        body={
          withoutAgent
            ? "No agent yet, and that's fine. Pick where calls run and paste your keys, and I'll help you get one."
            : "Pick where calls run and paste your keys."
        }
      />

      {/* Both cards stay mounted, so switching only animates widths and borders. */}
      <div className="mt-7 flex w-[440px] gap-3">
        <div
          className={cn(
            "relative shrink-0 transition-[width] duration-500 ease-in-out motion-reduce:transition-none",
            cloud ? "w-[90px]" : "w-[214px]"
          )}
        >
          <SetupCard
            className={cn(
              "w-full overflow-hidden transition-colors duration-500",
              !cloud && "border-primary"
            )}
            collapsed={cloud}
            tile={
              <Tile>
                <LiveKitLogo />
              </Tile>
            }
            name="LiveKit"
            status={<StatusLine tone="done" text="Local" />}
          />
          {cloud && (
            <ChooseButton
              label="Run LiveKit on this Mac"
              onClick={() => void chooseLiveKitServer("thisMac")}
            />
          )}
        </div>
        <div className="relative min-w-0 flex-1">
          <SetupCard
            className={cn(
              "w-full overflow-hidden transition-colors duration-500",
              cloud && "border-primary"
            )}
            tile={
              <Tile>
                <LiveKitLogo className="text-livekit-cloud" />
              </Tile>
            }
            name="LiveKit"
            status={
              cloud && keys.theirLiveKit ? (
                <StatusLine tone="done" text="Saved" />
              ) : (
                <StatusLine tone="cloud" text="Cloud" />
              )
            }
            action={
              <AnimatePresence initial={false}>
                {cloud && !keys.theirLiveKit && (
                  <motion.form
                    key="paste"
                    action={pasteLiveKitNow}
                    // In once the card has widened; out before it narrows.
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, transition: { delay: 0.35 } }}
                    exit={{ opacity: 0, transition: { duration: 0.15 } }}
                  >
                    <Button
                      type="submit"
                      disabled={pastingLiveKit}
                      className={PASTE_BUTTON}
                    >
                      <ClipboardPaste />
                      Paste all
                    </Button>
                  </motion.form>
                )}
              </AnimatePresence>
            }
          />
          {!cloud && (
            <ChooseButton
              label="Use LiveKit Cloud"
              onClick={() => void chooseLiveKitServer("theirs")}
            />
          )}
        </div>
      </div>
      <SetupCard
        className="mt-3"
        tile={
          <Tile>
            <GeminiLogo />
          </Tile>
        }
        name="Gemini"
        status={keys.gemini && <StatusLine tone="done" text="Saved" />}
        action={
          !keys.gemini && (
            <form action={pasteGeminiNow}>
              <Button
                type="submit"
                disabled={pastingGemini}
                className={PASTE_BUTTON}
              >
                <ClipboardPaste />
                Paste key
              </Button>
            </form>
          )
        }
      />

      {error && (
        <p className="mt-5 w-[440px] text-center text-[13px] leading-[18px] text-destructive">
          {error}
        </p>
      )}
      {/* Always there, so a failed paste still leaves the way to type them. */}
      <p
        className={cn(
          "w-[440px] text-center text-[13px] leading-[18px] text-balance text-muted-foreground",
          error ? "mt-2" : "mt-7"
        )}
      >
        Copy them from <Link href={LIVEKIT_KEYS}>LiveKit Cloud</Link> (Settings,
        API keys) and{" "}
        <span className="whitespace-nowrap">
          <Link href={GEMINI_KEYS}>Google AI Studio</Link>,
        </span>{" "}
        or{" "}
        <span className="whitespace-nowrap">
          <InlineLink onClick={() => setTyping(true)}>type them in</InlineLink>.
        </span>
      </p>
      {withoutAgent && (
        <p className="mt-3 flex items-center gap-1.5 text-[13px] leading-[18px] text-muted-foreground">
          Changed your mind?
          <InlineLink onClick={onSetUpAgent}>Set up an agent</InlineLink>
        </p>
      )}

      <KeysDialog keys={keys} open={typing} onOpenChange={setTyping} />
    </div>
  )
}

/** Covers a card to choose it; a sibling, so the card can hold its own buttons. */
function ChooseButton({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="absolute inset-0 rounded-[18px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    />
  )
}

/** Opens a page in the browser. */
function Link({ href, children }: { href: string; children: string }) {
  return <InlineLink onClick={() => void openUrl(href)}>{children}</InlineLink>
}
