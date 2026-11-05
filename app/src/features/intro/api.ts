import { invoke } from "@tauri-apps/api/core"

// The core's user name setting (src-tauri/src/settings.rs): what Bomby calls the user.

/** The longest name the core keeps (`MAX_USER_NAME_LEN` in settings.rs). */
export const MAX_USER_NAME_LENGTH = 50

/** What the user likes to be called, or "" when they haven't said. */
export function userName(): Promise<string> {
  return invoke("user_name")
}

/** Saves the name for the next call and resolves to it as saved (trimmed); "" clears it. */
export function setUserName(name: string): Promise<string> {
  return invoke("set_user_name", { name })
}
