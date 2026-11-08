import { RpcError } from "livekit-client"
import { describe, expect, it } from "vite-plus/test"

import { HOSTED_MCP_RPC } from "./hosted-rpc"
import { answer, methods, REFUSED } from "./rpc"

describe("hosted MCP extensions' RPC", () => {
  it("answers each vendor's open_link, as the agent names it", () => {
    expect(HOSTED_MCP_RPC.flatMap(methods).map(([method]) => method)).toEqual([
      "bomby.zapier.open_link",
      "bomby.composio.open_link",
    ])
  })

  it("refuses a request without a link before it reaches the core", async () => {
    const [zapier] = HOSTED_MCP_RPC
    const openLink = zapier!.handlers.open_link!
    await expect(answer(openLink, '{"url": 5}', 1)).rejects.toEqual(
      new RpcError(REFUSED, "Send the link to open.")
    )
  })
})
