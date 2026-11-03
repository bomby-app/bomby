import {
  AudioLines,
  KeyRound,
  ListChecks,
  type LucideIcon,
  Palette,
} from "lucide-react"
import type { ComponentType } from "react"

import { CredentialsSettings } from "@/features/credentials/credentials-settings"
import { SetupSettings } from "@/features/setup/setup-settings"
import { AppearanceSettings } from "@/features/theme/appearance-settings"
import { VoiceSettings } from "@/features/voice/voice-settings"

/**
 * The settings window's sections, in sidebar order. A new section is one entry here: an
 * icon, a label, and a component its feature exports.
 */
export const SECTIONS = [
  {
    id: "setup",
    label: "Setup",
    icon: ListChecks,
    component: SetupSettings,
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
] as const satisfies readonly Section[]

type Section = {
  id: string
  label: string
  icon: LucideIcon
  component: ComponentType
}

export type SectionId = (typeof SECTIONS)[number]["id"]
