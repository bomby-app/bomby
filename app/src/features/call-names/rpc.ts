import { renameCall } from "@/features/call/api"
import { type ExtensionRpc, record, Refusal } from "@/features/extensions/rpc"

// What Bomby's `name_call` asks this page over RPC (`agent/extensions/call_names.py`): the
// same command the user renames a call with, as Bomby, for the call it's on. The core
// checks the name; this only reads the request's shape.

export const CALL_NAMES_RPC: ExtensionRpc = {
  id: "call_names",
  handlers: {
    set: async (payload, { callId }) => {
      const { name } = record(payload)
      if (typeof name !== "string" || !name.trim())
        throw new Refusal("Say the name.")
      return renameCall(callId, name, "bomby")
    },
  },
}
