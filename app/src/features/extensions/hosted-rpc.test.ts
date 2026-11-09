import { RpcError } from "livekit-client"
import { describe, expect, it } from "vite-plus/test"

import type { ExtensionSetting } from "./api"
import { hostedMcpRpc } from "./hosted-rpc"
import { answer, methods, REFUSED } from "./rpc"

function extension(
  id: string,
  connection: ExtensionSetting["connection"]
): ExtensionSetting {
  return { id, name: id, description: "", on: true, connection }
}

const SETTINGS = [
  extension("todos", null),
  extension("zapier", {
    connected: true,
    connecting: false,
    account: null,
    manageUrl: "https://mcp.zapier.com",
  }),
  extension("composio", {
    connected: false,
    connecting: false,
    account: null,
    manageUrl: "https://connect.composio.dev",
  }),
]

describe("hosted MCP extensions' RPC", () => {
  it("answers open_link for each extension the core says signs in", () => {
    expect(
      hostedMcpRpc(SETTINGS)
        .flatMap(methods)
        .map(([method]) => method)
    ).toEqual(["bomby.zapier.open_link", "bomby.composio.open_link"])
  })

  it("refuses a request without a link before it reaches the core", async () => {
    const [zapier] = hostedMcpRpc(SETTINGS)
    const openLink = zapier!.handlers.open_link!
    await expect(answer(openLink, '{"url": 5}', 1)).rejects.toEqual(
      new RpcError(REFUSED, "Send the link to open.")
    )
  })
})
