import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { answer } from "@/features/extensions/rpc"

import { CALL_NAMES_RPC } from "./rpc"

const invoke = vi.hoisted(() => vi.fn())
vi.mock("@tauri-apps/api/core", () => ({ invoke }))

const CALL = { projectId: 2, callId: 7 }

describe("Bomby naming the call", () => {
  beforeEach(() => invoke.mockReset())

  it("renames the call it's on, as Bomby, and answers with the name", async () => {
    invoke.mockResolvedValue({ name: "Login flow", namedBy: "bomby" })
    const set = CALL_NAMES_RPC.handlers.set!
    expect(await answer(set, '{"name":"Login flow"}', CALL)).toBe(
      '{"name":"Login flow","namedBy":"bomby"}'
    )
    expect(invoke).toHaveBeenCalledWith("rename_call", {
      callId: 7,
      name: "Login flow",
      by: "bomby",
    })
  })

  it("refuses no name without asking the core", async () => {
    const set = CALL_NAMES_RPC.handlers.set!
    for (const payload of ['{"name":"  "}', "{}", '{"name":3}'])
      await expect(answer(set, payload, CALL)).rejects.toMatchObject({
        message: "Say the name.",
      })
    expect(invoke).not.toHaveBeenCalled()
  })
})
