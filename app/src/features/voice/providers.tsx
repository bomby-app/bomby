import { Globe, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { GeminiLogo, RimeLogo } from "@/features/setup/provider-logos"

import type { VoiceProvider } from "./api"
import { KEY_PAGES } from "./key-pages"

/** A provider's switch, as Settings, Voice shows it. */
type OptionCopy = {
  icon: LucideIcon
  title: string
  line: string
  info: string
}

/** How the app shows each voice provider; what it can do comes from the core (voice.rs). */
type ProviderCopy = {
  name: string
  /** What it runs, for the splash: "Gemini Live", "Prism". */
  model: string
  description: string
  logo: (props: { className?: string }) => ReactNode
  /** Where the user gets a key. */
  keysUrl: string
  /** Where the key is, for the splash's footnote: a page, and where on it. */
  keysPlace: string
  keysWhere?: string
  /** The same, as a sentence, for typing a key in. */
  keysHow: string
  options: Record<string, OptionCopy>
}

export const PROVIDERS: Record<VoiceProvider, ProviderCopy> = {
  gemini: {
    name: "Gemini",
    model: "Gemini Live",
    description: "Gemini Live, with your Google AI Studio key.",
    logo: GeminiLogo,
    keysUrl: KEY_PAGES.gemini,
    keysPlace: "Google AI Studio",
    keysHow: "From Google AI Studio, under API keys.",
    options: {
      google_search: {
        icon: Globe,
        title: "Google Search",
        line: "Bomby can look things up while you talk.",
        info: "Gemini searches the web on Google's side when a question needs it. Applies from your next call.",
      },
    },
  },
  rime: {
    name: "Rime",
    model: "Prism",
    description: "Prism, Rime's speech-to-speech model.",
    // A wordmark: sized by width in the logo tile.
    logo: ({ className }) => <RimeLogo className={className ?? "h-auto w-6"} />,
    keysUrl: KEY_PAGES.rime,
    keysPlace: "Rime's dashboard",
    keysWhere: "API tokens",
    keysHow: "From Rime's dashboard, under API tokens.",
    options: {},
  },
}

/** In the order the core lists them. */
export const PROVIDER_ORDER: VoiceProvider[] = ["gemini", "rime"]
