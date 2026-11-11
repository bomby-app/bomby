// What a start that failed, or was cancelled, leaves once the core had opened its call.
// The app has one LiveKit session, and after Cancel a newer start may already be on it
// when the cancelled start's opening answers: ending the session then would end the newer
// call too.

/**
 * Ends the session only while call `opened` is still the one it joined (`joined`), then
 * ends that call's row (`finish`) either way: joining may have failed before the room
 * connected, so no disconnect closes it.
 */
export async function endFailedStart(
  opened: number,
  {
    joined,
    endSession,
    finish,
  }: {
    joined: () => number | null
    endSession: () => Promise<void>
    finish: (callId: number) => Promise<void>
  }
): Promise<void> {
  if (joined() === opened) await endSession().catch(() => {})
  await finish(opened)
}
