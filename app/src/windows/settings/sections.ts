import {
  AudioLines,
  Blocks,
  Info,
  Bot,
  Brain,
  ListChecks,
  type LucideIcon,
  Palette,
  Server,
} from "lucide-react"
import type { ComponentType } from "react"

import { MascotIcon } from "@/components/app-logo"
import { AboutBadge, AboutSettings } from "@/features/about/about-settings"
import { AgentsSettings } from "@/features/agents/agents-settings"
import { CallServerSettings } from "@/features/call-server/call-server-settings"
import { ExtensionsSettings } from "@/features/extensions/extensions-settings"
import { IntroSettings } from "@/features/intro/intro-settings"
import { MemorySettings } from "@/features/memory/memory-settings"
import { SetupSettings } from "@/features/setup/setup-settings"
import { AppearanceSettings } from "@/features/theme/appearance-settings"
import { VoiceSettings } from "@/features/voice/voice-settings"

/**
 * The settings window's sections, in sidebar order. A new section is one entry here: an
 * icon, a label, and a component its feature exports; `badge`, if any, marks it in the
 * sidebar (it renders a `SidebarMenuBadge`, or nothing).
 */
export const SECTIONS = [
  {
    id: "setup",
    label: "Setup",
    icon: ListChecks,
    component: SetupSettings,
  },
  {
    id: "intro",
    label: "Bomby",
    icon: MascotIcon,
    component: IntroSettings,
  },
  {
    id: "agents",
    label: "Agents",
    icon: Bot,
    component: AgentsSettings,
  },
  {
    id: "voice",
    label: "Voice",
    icon: AudioLines,
    component: VoiceSettings,
  },
  {
    id: "memory",
    label: "Memory",
    icon: Brain,
    component: MemorySettings,
  },
  {
    id: "extensions",
    label: "Extensions",
    icon: Blocks,
    component: ExtensionsSettings,
  },
  {
    id: "call-server",
    label: "Call server",
    icon: Server,
    component: CallServerSettings,
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: Palette,
    component: AppearanceSettings,
  },
  {
    id: "about",
    label: "About",
    icon: Info,
    component: AboutSettings,
    badge: AboutBadge,
  },
] as const satisfies readonly Section[]

type Section = {
  id: string
  label: string
  icon: LucideIcon | typeof MascotIcon
  component: ComponentType
  badge?: ComponentType
}
