import { openExtensionLink } from "./api"
import { type ExtensionRpc, record, Refusal } from "./rpc"

// What the hosted MCP extensions' tools ask this page over RPC
// (`agent/extensions/hosted_mcp.py`): only `open_link`, to open a sign-in link a vendor's
// tool handed back. The core opens it, and only on that vendor's hosts.

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

export const HOSTED_MCP_RPC: ExtensionRpc[] = [
  hosted("zapier"),
  hosted("composio"),
]
