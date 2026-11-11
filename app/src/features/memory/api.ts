import type { Memory } from "@/generated/memory"
import { call } from "@/lib/core"

// The core's memory settings and Zep key; the key goes in, never comes back out.

export type { Memory } from "@/generated/memory"

export function memorySetting(): Promise<Memory> {
  return call("memory_setting")
}

/** Applies from the next call. */
export function setMemorySetting(memory: Memory): Promise<void> {
  return call("set_memory_setting", { memory })
}

/** Whether calls read memory but save nothing. */
export function memoryIncognito(): Promise<boolean> {
  return call("memory_incognito")
}

/** Applies from the next call. */
export function setMemoryIncognito(on: boolean): Promise<void> {
  return call("set_memory_incognito", { on })
}

export function hasZepKey(): Promise<boolean> {
  return call("has_zep_key")
}

export function saveZepKey(key: string): Promise<void> {
  return call("save_zep_key", { key })
}

export function clearZepKey(): Promise<void> {
  return call("clear_zep_key")
}
