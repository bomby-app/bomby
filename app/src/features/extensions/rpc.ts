import { RpcError } from "livekit-client"

// What an extension answers over LiveKit RPC (docs/decisions/extensions.md): Bomby's tools
// call `bomby.<extension>.<op>` on this page, which asks the core and answers with JSON
// (`agent/extensions/bridge.py`). A refusal carries a message for the user, which the
// voice model hears as is.

/** Bomby's own RPC error code: LiveKit keeps 1001 to 1999 (`REFUSED` in `bridge.py`). */
export const REFUSED = 2000

/** The most an answer may weigh: LiveKit's v1 limit is 15,360 bytes each way. */
export const MAX_ANSWER_BYTES = 14_000

/** A refusal for the user: a request Bomby can fix, such as a to-do that isn't there. */
export class Refusal extends Error {}

/** The call Bomby asks about: its project, and the call itself. */
export type RpcCall = { projectId: number; callId: number }

/** One operation: the request's payload (parsed JSON) and the call it's on, to an answer. */
type RpcHandler = (payload: unknown, call: RpcCall) => Promise<unknown>

/** An extension's operations, by name: `todos` with `add` answers `bomby.todos.add`. */
export type ExtensionRpc = { id: string; handlers: Record<string, RpcHandler> }

/** Each operation's full method name with its handler. */
export function methods(extension: ExtensionRpc): [string, RpcHandler][] {
  return Object.entries(extension.handlers).map(([op, handler]) => [
    `bomby.${extension.id}.${op}`,
    handler,
  ])
}

/**
 * Runs `handler` and turns what it says into an RPC answer: JSON, or a refusal Bomby
 * hears. The core rejects with a message for the user, as a string; anything else is a bug
 * and goes back as LiveKit's own "Application Error".
 */
export async function answer(
  handler: RpcHandler,
  payload: string,
  call: RpcCall
): Promise<string> {
  let request: unknown
  try {
    request = JSON.parse(payload)
  } catch {
    throw new RpcError(REFUSED, "That request wasn't readable.")
  }
  try {
    return JSON.stringify(await handler(request, call))
  } catch (e) {
    if (e instanceof Refusal) throw new RpcError(REFUSED, e.message)
    if (typeof e === "string") throw new RpcError(REFUSED, e)
    throw e
  }
}

/** The request as an object, or a refusal. */
export function record(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload))
    throw new Refusal("That request wasn't readable.")
  return payload as Record<string, unknown>
}
