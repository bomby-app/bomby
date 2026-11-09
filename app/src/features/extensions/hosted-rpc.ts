import { useMemo } from "react"

import { type ExtensionSetting, openExtensionLink } from "./api"
import { type ExtensionRpc, record, Refusal } from "./rpc"
import { useExtensions } from "./use-extensions"

// What the hosted MCP extensions' tools ask this page over RPC
// (`agent/extensions/hosted_mcp.py`): only `open_link`, to open a sign-in link a vendor's
// tool handed back. The core opens it, and only on that vendor's hosts. Which extensions
// are hosted comes from the core (each one that has a `connection`), so a new vendor needs
// nothing here.

function hosted(id: string): ExtensionRpc {
  return {
    id,
    handlers: {
      open_link: async (payload) => {
        const { url } = record(payload)
        if (typeof url !== "string") throw new Refusal("Send the link to open.")
        await openExtensionLink(id, url)
        return {}
      },
    },
  }
}

/** The handlers for every extension the core says signs in. */
export function hostedMcpRpc(settings: ExtensionSetting[]): ExtensionRpc[] {
  return settings.filter((e) => e.connection).map((e) => hosted(e.id))
}

/**
 * `hostedMcpRpc` for this page, the same list until the set of hosted extensions changes,
 * so a sign-in starting or ending doesn't re-register the room's methods.
 */
export function useHostedMcpRpc(): ExtensionRpc[] {
  const settings = useExtensions()
  const ids = hostedMcpRpc(settings ?? [])
    .map((e) => e.id)
    .join(",")
  return useMemo(() => (ids ? ids.split(",").map(hosted) : []), [ids])
}
