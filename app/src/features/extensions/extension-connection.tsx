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

/**
 * A hosted MCP extension's own settings, under its row in Settings, Extensions: Connect,
 * which signs in to the vendor in the browser, then who it's connected as, the vendor's page
 * and Disconnect (docs/decisions/hosted-mcp-extensions-with-oauth.md). Whether a sign-in is
 * under way comes from the core, so it still shows after leaving the section, in any window.
 */
export function ExtensionConnection({
  extension,
}: {
  extension: ExtensionSetting
}) {
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const connection = extension.connection
  if (!connection) return null
  const { name } = extension
  const { manageUrl, connecting } = connection

  async function connect() {
    setError(null)
    try {
      setExtensions(await connectExtension(extension.id))
    } catch (e) {
      if (String(e) !== CANCELLED) setError(String(e))
    }
  }

  async function disconnect() {
    setError(null)
    setDisconnecting(true)
    try {
      setExtensions(await disconnectExtension(extension.id))
    } catch (e) {
      setError(String(e))
    } finally {
      setDisconnecting(false)
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
          {connecting
            ? `Finish signing in to ${name} in your browser.`
            : `Sign in to ${name} so Bomby can use your apps there. Calls get it once it's connected.`}
        </p>
      )}
      {error && <FieldError>{error}</FieldError>}
      <div className="flex items-center gap-2">
        {connection.connected ? (
          <Button
            variant="outline"
            disabled={disconnecting}
            onClick={disconnect}
          >
            {disconnecting ? "Disconnecting..." : "Disconnect"}
          </Button>
        ) : connecting ? (
          <>
            <Button disabled>Waiting for your browser...</Button>
            <Button
              variant="ghost"
              onClick={() => void cancelExtensionConnect(extension.id)}
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
