import { readText } from "@tauri-apps/plugin-clipboard-manager"
import { openUrl } from "@tauri-apps/plugin-opener"
import { ClipboardPaste } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { type ReactNode, useActionState, useState } from "react"

import { InlineLink } from "@/components/inline-link"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { saveCredentials } from "@/features/call-server/api"
import { parseLiveKitEnv } from "@/features/call-server/livekit-env"
import {
  checkKeysAgain,
  chooseLiveKitServer,
  chooseVoiceProvider,
  useSavedKeys,
  type Keys,
} from "@/features/call-server/use-saved-keys"
import { LiveKitLogo } from "@/features/setup/provider-logos"
import { saveVoiceKey, type VoiceProvider } from "@/features/voice/api"
import { PROVIDER_ORDER, PROVIDERS } from "@/features/voice/providers"
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

/** One width, so the paste buttons line up. */
const PASTE_BUTTON = cn(CARD_BUTTON, "w-32")

/** An API key: one token, no spaces. */
const API_KEY = /^\S{16,}$/

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

/** Saves the picked provider's key from the clipboard (the form's `provider`). */
async function pasteVoiceKey(
  _: string | null,
  form: FormData
): Promise<string | null> {
  const provider = form.get("provider") as VoiceProvider
  const key = ((await readText().catch(() => "")) ?? "").trim()
  if (!API_KEY.test(key))
    return `Copy your API key from ${PROVIDERS[provider].keysPlace}, then paste again.`
  try {
    await saveVoiceKey(provider, key)
  } catch (e) {
    return String(e)
  }
  await checkKeysAgain()
  return null
}

/**
 * The splash's second step: where calls run and who Bomby talks through, each a row of two
 * cards, with the user's own keys (docs/decisions/users-bring-their-own-keys-and-claude.md).
 * Gemini is picked at first, the default; picking one eases the other down to its tile and
 * widens it with Paste key, the same move as LiveKit Cloud. A key pastes in one click; typing them
 * is a dialog away. After Set up later there's no agent yet: the heading says a call can
 * still talk, and the footnote offers the way back.
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
  const [voiceError, pasteVoiceNow, pastingVoice] = useActionState(
    pasteVoiceKey,
    null
  )
  const [typing, setTyping] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  // A failed choice lands in the store, not in this step's state.
  const { error: keysError } = useSavedKeys()
  const error = livekitError ?? voiceError ?? linkError ?? keysError
  const cloud = keys.server === "theirs"
  const [left, right] = PROVIDER_ORDER

  return (
    <div className="flex flex-col items-center gap-7">
      <div className="flex flex-col items-center">
        <StepHeading
          title={
            allSet
              ? "You're all set"
              : withoutAgent
                ? "Let's still talk"
                : "Just one more step"
          }
          body="Pick where calls run and who Bomby talks through."
        />
      </div>

      <div className="flex w-[440px] flex-col gap-5">
        <Row label="Calls run on">
          <CardPair
            selected={cloud ? "right" : "left"}
            // Only Cloud needs the room, for its keys.
            widened={cloud ? "right" : null}
            left={{
              tile: <LiveKitLogo />,
              name: "LiveKit",
              status: <StatusLine tone="done" text="Local" />,
              choose: "Run LiveKit on this Mac",
              onChoose: () => void chooseLiveKitServer("thisMac"),
            }}
            right={{
              tile: <LiveKitLogo className="text-livekit-cloud" />,
              name: "LiveKit",
              status:
                cloud && keys.theirLiveKit ? (
                  <StatusLine tone="done" text="Saved" />
                ) : (
                  <StatusLine tone="cloud" text="Cloud" />
                ),
              action: cloud && !keys.theirLiveKit && (
                <form action={pasteLiveKitNow}>
                  <PasteButton disabled={pastingLiveKit}>Paste all</PasteButton>
                </form>
              ),
              choose: "Use LiveKit Cloud",
              onChoose: () => void chooseLiveKitServer("theirs"),
            }}
          />
        </Row>
        <Row label="Bomby talks through">
          <CardPair
            selected={side(keys.voice)}
            widened={side(keys.voice)}
            left={voiceCard(left, keys, pasteVoiceNow, pastingVoice)}
            right={voiceCard(right, keys, pasteVoiceNow, pastingVoice)}
          />
        </Row>
      </div>

      <div className="flex w-[440px] flex-col items-center gap-2">
        {error && (
          <p className="text-center text-sm text-destructive">{error}</p>
        )}
        {/* Always there, so a failed paste still leaves the way to type them. */}
        <Footnote
          keys={keys}
          onType={() => setTyping(true)}
          onLinkError={setLinkError}
        />
        {withoutAgent && (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            Changed your mind?
            <InlineLink onClick={onSetUpAgent}>Set up an agent</InlineLink>
          </p>
        )}
      </div>

      <KeysDialog keys={keys} open={typing} onOpenChange={setTyping} />
    </div>
  )
}

/** Which side of the voice row a provider sits on. */
function side(provider: VoiceProvider | null): "left" | "right" | null {
  if (provider === null) return null
  return provider === PROVIDER_ORDER[0] ? "left" : "right"
}

/** A provider's card: its model until it's picked, then Paste key, then Saved. */
function voiceCard(
  provider: VoiceProvider,
  keys: Keys,
  paste: (form: FormData) => void,
  pasting: boolean
): Card {
  const copy = PROVIDERS[provider]
  const Logo = copy.logo
  const picked = keys.voice === provider
  const saved = keys.voiceKeys[provider]
  return {
    tile: <Logo className={provider === "rime" ? "h-auto w-9" : undefined} />,
    mark: copy.experimental && <ExperimentalMark />,
    name: copy.name,
    status: !picked ? (
      <StatusLine tone="off" text={copy.model} />
    ) : (
      saved && <StatusLine tone="done" text={`Saved · ${copy.model}`} />
    ),
    action: picked && !saved && (
      <form action={paste}>
        <input type="hidden" name="provider" value={provider} />
        <PasteButton disabled={pasting}>Paste key</PasteButton>
      </form>
    ),
    choose: `Talk through ${copy.name}`,
    onChoose: () => void chooseVoiceProvider(provider),
  }
}

type Card = {
  tile: ReactNode
  /** A small mark on the tile's corner, like Experimental. */
  mark?: ReactNode
  name: string
  status?: ReactNode
  action?: ReactNode
  /** The label of the button that picks it. */
  choose: string
  onChoose: () => void
}

/** Both cards' widths: even, or the widened one taking what its neighbour's tile leaves. */
const EVEN = "w-[214px]"
const WIDE = "w-[338px]"
const TILE = "w-[90px]"

/**
 * Two cards for one choice. Both stay mounted, so a change only animates widths and borders;
 * the picked one is outlined, and a widened one leaves its neighbour only its tile. A card
 * that isn't picked is a button that picks it.
 */
function CardPair({
  selected,
  widened,
  left,
  right,
}: {
  selected: "left" | "right" | null
  widened: "left" | "right" | null
  left: Card
  right: Card
}) {
  return (
    <div className="flex w-[440px] gap-3">
      {(["left", "right"] as const).map((at) => {
        const card = at === "left" ? left : right
        const width = widened === null ? EVEN : widened === at ? WIDE : TILE
        const collapsed = widened !== null && widened !== at
        return (
          <div
            key={at}
            className={cn(
              "relative shrink-0 transition-[width] duration-500 ease-in-out motion-reduce:transition-none",
              width
            )}
          >
            <SetupCard
              className={cn(
                "w-full overflow-hidden transition-colors duration-500",
                selected === at && "border-primary"
              )}
              collapsed={collapsed}
              tile={
                <Tile className="relative">
                  {card.tile}
                  {card.mark}
                </Tile>
              }
              name={card.name}
              status={card.status}
              action={
                <AnimatePresence initial={false}>
                  {card.action && (
                    <motion.div
                      key="action"
                      // In once the card has widened; out before it narrows.
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1, transition: { delay: 0.35 } }}
                      exit={{ opacity: 0, transition: { duration: 0.15 } }}
                    >
                      {card.action}
                    </motion.div>
                  )}
                </AnimatePresence>
              }
            />
            {selected !== at && (
              <button
                type="button"
                aria-label={card.choose}
                onClick={card.onChoose}
                className="absolute inset-0 rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

/** An E on the tile's corner, Experimental on hover; above the card's pick button. */
function ExperimentalMark() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="absolute -top-1 -right-1 z-10 flex size-4 items-center justify-center rounded-full bg-highlighter text-[10px] leading-none font-bold text-highlighter-foreground">
          E
        </span>
      </TooltipTrigger>
      <TooltipContent>Experimental</TooltipContent>
    </Tooltip>
  )
}

/** A row's label over its cards. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="pl-1 font-mono text-label text-muted-foreground uppercase">
        {label}
      </span>
      {children}
    </div>
  )
}

function PasteButton({
  disabled,
  children,
}: {
  disabled: boolean
  children: string
}) {
  return (
    <Button type="submit" disabled={disabled} className={PASTE_BUTTON}>
      <ClipboardPaste />
      {children}
    </Button>
  )
}

/**
 * Where the keys still needed come from, and the way to type them in; before a voice is
 * picked, that it can change later.
 */
function Footnote({
  keys,
  onType,
  onLinkError,
}: {
  keys: Keys
  onType: () => void
  onLinkError: (message: string) => void
}) {
  const livekit = keys.server === "theirs" && !keys.theirLiveKit
  const voice = keys.voice && PROVIDERS[keys.voice]
  const type = (text: string) => (
    <span className="whitespace-nowrap">
      <InlineLink onClick={onType}>{text}</InlineLink>.
    </span>
  )
  const livekitPlace = (
    <>
      <Link href={LIVEKIT_KEYS} onError={onLinkError}>
        LiveKit Cloud
      </Link>{" "}
      (Settings, API keys)
    </>
  )
  const voicePlace = voice && (
    <>
      <Link href={voice.keysUrl} onError={onLinkError}>
        {voice.keysPlace}
      </Link>
      {voice.keysWhere && ` (${voice.keysWhere})`}
    </>
  )

  return (
    <p className="text-center text-sm text-balance text-muted-foreground">
      {!voice ? (
        livekit ? (
          <>
            Copy your keys from {livekitPlace}, or {type("type them in")} Then
            pick a voice.
          </>
        ) : (
          <>Pick a voice. You can switch any time in Settings.</>
        )
      ) : livekit ? (
        <>
          Copy them from {livekitPlace} and {voicePlace}, or{" "}
          {type("type them in")}
        </>
      ) : (
        <>
          Copy your key from {voicePlace}, or {type("type it in")}
        </>
      )}
    </p>
  )
}

/** Opens a page in the browser, or says it couldn't. */
function Link({
  href,
  onError,
  children,
}: {
  href: string
  onError: (message: string) => void
  children: string
}) {
  return (
    <InlineLink
      onClick={() =>
        openUrl(href).catch(() =>
          onError(`Couldn't open ${href}. Open it in your browser.`)
        )
      }
    >
      {children}
    </InlineLink>
  )
}
