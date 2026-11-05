import {
  AudioLines,
  Info,
  Bot,
  KeyRound,
  ListChecks,
  type LucideIcon,
  Palette,
} from "lucide-react"
import type { ComponentType } from "react"

import { AboutBadge, AboutSettings } from "@/features/about/about-settings"
import { AgentsSettings } from "@/features/agents/agents-settings"
import { CredentialsSettings } from "@/features/credentials/credentials-settings"
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
    id: "appearance",
    label: "Appearance",
    icon: Palette,
    component: AppearanceSettings,
  },
  {
    id: "credentials",
    label: "Credentials",
    icon: KeyRound,
    component: CredentialsSettings,
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
  icon: LucideIcon
  component: ComponentType
  badge?: ComponentType
}

export type SectionId = (typeof SECTIONS)[number]["id"]
