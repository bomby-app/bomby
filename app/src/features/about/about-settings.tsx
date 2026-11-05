import { openUrl } from "@tauri-apps/plugin-opener"
import { LoaderCircle } from "lucide-react"
import { useState, useTransition } from "react"

import { AppLogo } from "@/components/app-logo"
import { ErrorCard } from "@/components/error-card"
import { InlineLink } from "@/components/inline-link"
import { MascotCard } from "@/components/mascot-card"
import { Button } from "@/components/ui/button"
import { SidebarMenuBadge } from "@/components/ui/sidebar"
import { Wordmark } from "@/components/wordmark"

import { checkForUpdates, installUpdate, type UpdateStatus } from "./api"
import { GitHubMark } from "./github-mark"
import { useAbout } from "./use-about"

/** Bomby's source, and its releases. Granted to this window in capabilities/settings.json. */
const REPO = "https://github.com/bomby-app/bomby"

/**
 * The About section of the settings window: the app's version, and its updates
 * (docs/releasing.md). Release builds check once at launch; installing waits for the user.
 */
export function AboutSettings() {
  const info = useAbout()
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
        <AppLogo className="size-14" />
        <div className="flex flex-col gap-1">
          <Wordmark className="text-2xl leading-7" />
          <p className="text-sm text-muted-foreground select-text">
            {info ? versionLine(info.version, info.status) : " "}
          </p>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <GitHubMark className="size-3.5" />
            <InlineLink onClick={() => void openUrl(REPO)}>
              bomby-app/bomby
            </InlineLink>
          </p>
        </div>
      </div>
      {error && <ErrorCard message={error} />}
      {info && (
        <UpdateRow
          status={info.status}
          busy={pending}
          onCheck={check}
          onInstall={install}
        />
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
  const info = useAbout()
  const kind = info?.status.kind
  if (kind !== "available" && kind !== "downloaded") return null
  return (
    <SidebarMenuBadge>
      <span className="size-2 rounded-full bg-highlighter" />
      <span className="sr-only">Update ready</span>
    </SidebarMenuBadge>
  )
}
