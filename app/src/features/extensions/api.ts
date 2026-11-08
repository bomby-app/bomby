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
