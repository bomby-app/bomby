import { openUrl } from "@tauri-apps/plugin-opener"
import { useState } from "react"

import { InlineLink } from "@/components/inline-link"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"

import {
  CANCELLED,
  cancelExtensionConnect,
  connectExtension,
  disconnectExtension,
  type ExtensionSetting,
} from "./api"
import { setExtensions } from "./use-extensions"

type Status = "idle" | "connecting" | "disconnecting"

/**
 * A hosted MCP extension's own settings, under its row in Settings, Extensions: Connect,
 * which signs in to the vendor in the browser, then who it's connected as, the vendor's page
 * and Disconnect (docs/decisions/hosted-mcp-extensions-with-oauth.md).
 */
export function ExtensionConnection({
  extension,
}: {
  extension: ExtensionSetting
}) {
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState<string | null>(null)
  const connection = extension.connection
  if (!connection) return null
  const { name } = extension
  const { manageUrl } = connection

  async function connect() {
    setError(null)
    setStatus("connecting")
    try {
      setExtensions(await connectExtension(extension.id))
    } catch (e) {
      if (String(e) !== CANCELLED) setError(String(e))
    } finally {
      setStatus("idle")
    }
  }

  async function disconnect() {
    setError(null)
    setStatus("disconnecting")
    try {
      setExtensions(await disconnectExtension(extension.id))
    } catch (e) {
      setError(String(e))
    } finally {
      setStatus("idle")
    }
  }

  function manage() {
    setError(null)
    openUrl(manageUrl).catch(() =>
      setError(`Couldn't open ${manageUrl}. Open it in your browser.`)
    )
  }

  return (
    <>
      {connection.connected ? (
        <p className="text-sm text-muted-foreground">
          Connected
          {connection.account && (
            <>
              {" "}
              as{" "}
              <span className="font-medium text-foreground select-text">
                {connection.account}
              </span>
            </>
          )}
          . Pick the apps Bomby can use on{" "}
          <InlineLink onClick={manage}>{name}&apos;s site</InlineLink>.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {status === "connecting"
            ? `Finish signing in to ${name} in your browser.`
            : `Sign in to ${name} so Bomby can use your apps there. Calls get it once it's connected.`}
        </p>
      )}
      {error && <FieldError>{error}</FieldError>}
      <div className="flex items-center gap-2">
        {connection.connected ? (
          <Button
            variant="outline"
            disabled={status !== "idle"}
            onClick={disconnect}
          >
            {status === "disconnecting" ? "Disconnecting..." : "Disconnect"}
          </Button>
        ) : status === "connecting" ? (
          <>
            <Button disabled>Waiting for your browser...</Button>
            <Button
              variant="ghost"
              onClick={() => void cancelExtensionConnect()}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button onClick={connect}>Connect {name}</Button>
        )}
      </div>
    </>
  )
}
