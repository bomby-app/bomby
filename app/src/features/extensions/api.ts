import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

import type { ExtensionSetting } from "@/generated/extensions"

// The core's extension settings (src-tauri/src/extensions/, docs/decisions/extensions.md):
// which extensions every project's calls have unless a project picks its own.

export type { ExtensionSetting } from "@/generated/extensions"
export type { ProjectExtensions } from "@/generated/projects"

export function extensionsSettings(): Promise<ExtensionSetting[]> {
  return invoke("extensions_settings")
}

/** Applies from the next call. Resolves to every extension as it is now. */
export function setExtension(
  id: string,
  on: boolean
): Promise<ExtensionSetting[]> {
  return invoke("set_extension", { id, on })
}

/** An extension was turned on or off in Settings, in any window. Returns the unlisten. */
export function onExtensionsChanged(handler: () => void): Promise<UnlistenFn> {
  return listen("extensions-changed", () => handler())
}

// The hosted MCP extensions' sign-ins (src-tauri/src/extensions/connections.rs,
// docs/decisions/hosted-mcp-extensions-with-oauth.md). No token ever comes back.

/** What the core says when a sign-in is cancelled; not an error to show. */
export const CANCELLED = "The sign-in was cancelled."

/**
 * Opens the vendor's sign-in in the browser and resolves once the user finishes, with every
 * extension as it is now. Rejects with a message for the user, or `CANCELLED`.
 */
export function connectExtension(id: string): Promise<ExtensionSetting[]> {
  return invoke("connect_extension", { id })
}

export function cancelExtensionConnect(): Promise<void> {
  return invoke("cancel_extension_connect")
}

export function disconnectExtension(id: string): Promise<ExtensionSetting[]> {
  return invoke("disconnect_extension", { id })
}

/** Opens a link one of the extension's tools handed Bomby, only on the vendor's hosts. */
export function openExtensionLink(id: string, url: string): Promise<void> {
  return invoke("open_extension_link", { id, url })
}
