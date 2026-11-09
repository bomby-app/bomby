import { useSessionContext } from "@livekit/components-react"
import { ParticipantKind, RpcError } from "livekit-client"
import { useEffect, useEffectEvent } from "react"

import { useCall } from "@/features/call/call-provider"

import { answer, type ExtensionRpc, methods, REFUSED } from "./rpc"

/**
 * Answers Bomby's extension tools while a call is on (docs/decisions/extensions.md): each
 * extension's operations as RPC methods on the session's room, which stays the same across
 * calls. Only the call's agent may ask, and only about the call itself and its project. Mounted once,
 * inside the call provider, with every extension the page has.
 */
export function ExtensionRpcBridge({
  extensions,
}: {
  extensions: ExtensionRpc[]
}) {
  const { room } = useSessionContext()
  const { active } = useCall()

  /** The call on now, if Bomby is the one asking. */
  const callFor = useEffectEvent((caller: string) => {
    const participant = room.remoteParticipants.get(caller)
    if (participant?.kind !== ParticipantKind.AGENT || !active) return null
    return { projectId: active.projectId, callId: active.callId }
  })

  useEffect(() => {
    const registered = extensions.flatMap(methods)
    for (const [method, handler] of registered) {
      room.registerRpcMethod(method, async (data) => {
        const call = callFor(data.callerIdentity)
        if (call === null)
          throw new RpcError(REFUSED, "Only Bomby on a call can ask that.")
        return answer(handler, data.payload, call)
      })
    }
    return () => {
      for (const [method] of registered) room.unregisterRpcMethod(method)
    }
  }, [room, extensions])

  return null
}
