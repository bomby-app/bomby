import { agentsStatus } from "@/features/agents/api"
import type { PageReady } from "@/generated/launch"
import { call } from "@/lib/core"
import { log } from "@/lib/log"

/**
 * Tells the core the main window rendered (`splash` or `workspace`) and its read of the
 * agents answered, once per launch: a line in `app.log`, and the page's half of the launch
 * smoke check (src-tauri/src/smoke.rs).
 */
export async function reportReady(rendered: PageReady["rendered"]) {
  try {
    const agents = await agentsStatus()
    await call("main_window_ready", {
      ready: { rendered, agents: agents.length } satisfies PageReady,
    })
  } catch (e) {
    log(`The main window couldn't read the agents at launch: ${String(e)}`)
  }
}
