import { invoke } from "@tauri-apps/api/core"

import type { Memory } from "@/generated/memory"

// The core's memory setting and Zep key (src-tauri/src/settings.rs, credentials.rs). The key
// goes in, never comes back out.

export type { Memory } from "@/generated/memory"

export function memorySetting(): Promise<Memory> {
  return invoke("memory_setting")
}

/** Applies from the next call. */
export function setMemorySetting(memory: Memory): Promise<void> {
  return invoke("set_memory_setting", { memory })
}

/** Whether calls read memory but save nothing. */
export function memoryIncognito(): Promise<boolean> {
  return invoke("memory_incognito")
}

/** Applies from the next call. */
export function setMemoryIncognito(on: boolean): Promise<void> {
  return invoke("set_memory_incognito", { on })
}

export function hasZepKey(): Promise<boolean> {
  return invoke("has_zep_key")
}

export function saveZepKey(key: string): Promise<void> {
  return invoke("save_zep_key", { key })
}

export function clearZepKey(): Promise<void> {
  return invoke("clear_zep_key")
}
