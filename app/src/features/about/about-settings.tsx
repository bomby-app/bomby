import { openUrl } from "@tauri-apps/plugin-opener"
import { ArrowUpRight, FileArchive, LoaderCircle } from "lucide-react"
import { Fragment, useState, useTransition } from "react"

import { BetaBadge } from "@/components/beta-badge"
import { ErrorCard } from "@/components/error-card"
import { InlineLink } from "@/components/inline-link"
import { MascotCard } from "@/components/mascot-card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarMenuBadge } from "@/components/ui/sidebar"
import { Wordmark } from "@/components/wordmark"

import { checkForUpdates, installUpdate, type UpdateStatus } from "./api"
import iconDark from "./app-icon-dark@2x.png"
import iconLight from "./app-icon-light@2x.png"
import { useAbout } from "./use-about"
import { showLastExport, startExport, useDiagnostics } from "./use-diagnostics"

/** Where Bomby lives. Each URL is granted to this window in capabilities/settings.json. */
const LINKS = [
  { label: "Website", value: "bomby.app", url: "https://bomby.app" },
  {
    label: "Source code",
    value: "github.com/bomby-app/bomby",
    url: "https://github.com/bomby-app/bomby",
  },
  {
    label: "Made by",
    value: "@AbuRadyx on X",
    url: "https://x.com/AbuRadyx",
  },
  {
    label: "License",
    value: "MIT",
    url: "https://github.com/bomby-app/bomby/blob/main/LICENSE",
  },
] as const

/**
 * The About section of the settings window, laid out like a macOS About pane: the app icon,
 * name and version, then updates (docs/releasing.md; release builds check once at
 * launch, installing waits for the user), where Bomby lives, and Export Diagnostics.
 */
export function AboutSettings() {
  const { info, error: readError } = useAbout()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function check() {
    setError(null)
    startTransition(async () => {
      await checkForUpdates()
    })
  }

  function install() {
    setError(null)
    startTransition(async () => {
      try {
        await installUpdate()
      } catch (e) {
        setError(String(e))
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <AppIcon />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <Wordmark className="text-2xl leading-7" />
            <BetaBadge />
          </div>
          <p className="text-sm text-muted-foreground select-text">
            {info ? versionLine(info.version, info.status) : "\u00a0"}
          </p>
        </div>
      </div>
      {readError && <ErrorCard message={readError} />}
      {error && <ErrorCard message={error} />}
      {info && (
        <UpdateRow
          status={info.status}
          busy={pending}
          onCheck={check}
          onInstall={install}
        />
      )}
      <LinkList />
      <Diagnostics />
    </div>
  )
}

/**
 * Bomby's icon as the Dock shows it, gloss and depth and all: Icon Composer's light and
 * dark renditions of src-tauri/icons/Bomby.icon at 2x (scripts/export-about-icon.sh),
 * following the page's theme. The 64px box holds the tile with macOS's margin around it.
 */
function AppIcon() {
  return (
    <div className="size-16 shrink-0" aria-hidden>
      <img
        src={iconLight}
        alt=""
        draggable={false}
        className="block size-16 dark:hidden"
      />
      <img
        src={iconDark}
        alt=""
        draggable={false}
        className="hidden size-16 dark:block"
      />
    </div>
  )
}

/** One card of rows, each opening a page in the browser; one that won't open says so. */
function LinkList() {
  const [error, setError] = useState<string | null>(null)

  async function open(link: (typeof LINKS)[number]) {
    setError(null)
    try {
      await openUrl(link.url)
    } catch {
      setError(
        `Your browser didn't open ${link.label}. Go to ${link.value} instead.`
      )
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg border bg-card">
        {LINKS.map((link, index) => (
          <Fragment key={link.url}>
            {index > 0 && <Separator />}
            <button
              type="button"
              className="flex w-full items-center gap-4 px-4 py-3 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
              onClick={() => void open(link)}
            >
              <span className="shrink-0 font-medium">{link.label}</span>
              <span className="ml-auto flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <span className="truncate" title={link.value}>
                  {link.value}
                </span>
                <ArrowUpRight className="size-4 shrink-0" />
              </span>
            </button>
          </Fragment>
        ))}
      </div>
      {error && <ErrorCard message={error} />}
    </div>
  )
}

/**
 * Export Diagnostics: Bomby's logs and a short summary in one zip on the Desktop, with the
 * keys and tokens Bomby knows, and text shaped like them, taken out; the core shows it in
 * Finder. Its state lives in a page-wide store (use-diagnostics.ts), so leaving About
 * mid-export loses nothing. The zip's name, and Show in Finder, stay under the button once
 * it's saved.
 */
function Diagnostics() {
  const { status, fileName } = useDiagnostics()
  const exporting = status.kind === "exporting"

  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        variant="outline"
        disabled={exporting}
        onClick={() => void startExport()}
      >
        {exporting ? (
          <LoaderCircle data-icon="inline-start" className="animate-spin" />
        ) : (
          <FileArchive data-icon="inline-start" />
        )}
        Export diagnostics
      </Button>
      {fileName ? (
        <output className="block text-sm text-muted-foreground">
          Saved{" "}
          <span className="font-medium text-foreground select-text">
            {fileName}
          </span>{" "}
          to your Desktop.{" "}
          <InlineLink
            disabled={exporting}
            onClick={() => void showLastExport()}
          >
            Show in Finder
          </InlineLink>
        </output>
      ) : (
        <p className="text-sm text-muted-foreground">
          Bomby&apos;s logs in one zip on your Desktop, with the keys Bomby
          knows and anything shaped like a key or token taken out. Look it over
          before you share it publicly.
        </p>
      )}
      {status.kind === "failed" && (
        <ErrorCard message={status.message} className="w-full" />
      )}
    </div>
  )
}

function versionLine(version: string, status: UpdateStatus): string {
  return status.kind === "development"
    ? `Version ${version} · Development build`
    : `Version ${version}`
}

/**
 * Where updating stands. An update that's ready, or on its way, gets the mascot's card,
 * done face and all (Paper "04 Mascot states"); a failed check gets the error card; the
 * rest is a quiet row with Check for updates.
 */
function UpdateRow({
  status,
  busy,
  onCheck,
  onInstall,
}: {
  status: UpdateStatus
  busy: boolean
  onCheck: () => void
  onInstall: () => void
}) {
  switch (status.kind) {
    case "available":
      return (
        <MascotCard
          state="done"
          announce="status"
          headline={`Version ${status.version} is ready.`}
          detail="Restart Bomby to update. It takes a few seconds."
          action={
            <Button disabled={busy} onClick={onInstall}>
              Restart to update
            </Button>
          }
        />
      )
    case "downloaded":
      return (
        <MascotCard
          state="done"
          announce="status"
          headline={`Version ${status.version} is downloaded.`}
          detail="Restart Bomby to finish, once your call is over."
          action={
            <Button disabled={busy} onClick={onInstall}>
              Restart to update
            </Button>
          }
        />
      )
    case "downloading":
      return (
        <MascotCard
          state="thinking"
          announce="status"
          headline={`Getting version ${status.version}...`}
          detail={
            status.percent === null
              ? "Bomby restarts when it's done."
              : `${status.percent}% · Bomby restarts when it's done.`
          }
        />
      )
    case "restarting":
      return (
        <MascotCard
          state="waking"
          announce="status"
          headline="Restarting..."
          detail="Bomby is back in a moment."
        />
      )
    case "failed":
      return (
        <ErrorCard
          message={status.message}
          action={
            <Button variant="outline" disabled={busy} onClick={onCheck}>
              Try again
            </Button>
          }
        />
      )
    default:
      return (
        <div className="flex items-center gap-3 rounded-lg border px-3 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-medium">Updates</span>
            <span className="text-sm text-muted-foreground">
              {quietLine(status)}
            </span>
          </div>
          {status.kind === "checking" ? (
            <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            status.kind !== "development" && (
              <Button variant="outline" disabled={busy} onClick={onCheck}>
                Check for updates
              </Button>
            )
          )}
        </div>
      )
  }
}

function quietLine(status: UpdateStatus): string {
  switch (status.kind) {
    case "development":
      return "Updates come with release builds."
    case "checking":
      return "Checking..."
    case "upToDate":
      return "You're up to date."
    default:
      return "Bomby checks when it starts."
  }
}

/** About's mark in the settings sidebar: a highlighter dot while an update is ready. */
export function AboutBadge() {
  const { info } = useAbout()
  const kind = info?.status.kind
  if (kind !== "available" && kind !== "downloaded") return null
  return (
    <SidebarMenuBadge>
      <span className="size-2 rounded-full bg-highlighter" />
      <span className="sr-only">Update ready</span>
    </SidebarMenuBadge>
  )
}
