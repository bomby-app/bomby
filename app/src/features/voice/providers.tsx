import { Globe, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import {
  GeminiLogo,
  OpenAILogo,
  RimeLogo,
} from "@/features/setup/provider-logos"

import type { VoiceProvider } from "./api"
import { KEY_PAGES } from "./key-pages"

/** How Settings, Voice shows one of a provider's options, by its kind in the catalogue. */
type OptionCopy =
  | {
      /** A row with its icon, a line under the title, and a switch. */
      kind: "switch"
      icon: LucideIcon
      title: string
      line: string
      info: string
    }
  | {
      /** A labelled select; choices in a row share one line, the first one widest. */
      kind: "choice"
      title: string
      info?: string
    }

/**
 * How the app shows each voice provider; what it can do comes from the core (voice.rs),
 * which has it from the agent's catalogue (a test checks this covers it).
 */
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
  /** The logo's size on the splash's 56px tile, when 30px square isn't right. */
  tileClassName?: string
  /** Still settling in Bomby: marked Experimental in Settings and on the splash. */
  experimental?: boolean
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
        kind: "switch",
        icon: Globe,
        title: "Google Search",
        line: "Bomby can look things up while you talk.",
        info: "Gemini searches the web on Google's side when a question needs it. Applies from your next call.",
      },
    },
  },
  openai: {
    name: "OpenAI",
    model: "gpt-live-1",
    description: "gpt-live-1, with your OpenAI key.",
    logo: OpenAILogo,
    tileClassName: "h-7 w-7",
    keysUrl: KEY_PAGES.openai,
    keysPlace: "OpenAI's dashboard",
    keysWhere: "API keys",
    keysHow: "From OpenAI's dashboard, under API keys.",
    options: {
      web_search: {
        kind: "switch",
        icon: Globe,
        title: "Web search",
        line: "Bomby can look things up while you talk.",
        info: "The response model searches the web on OpenAI's side when a question needs it. Applies from your next call.",
      },
      response_model: {
        kind: "choice",
        title: "Response model",
        info: "gpt-live-1 does the talking. This model writes what Bomby says; Effort sets how long it thinks first.",
      },
      reasoning_effort: { kind: "choice", title: "Effort" },
    },
  },
  rime: {
    name: "Rime",
    model: "Prism",
    description: "Prism, Rime's speech-to-speech model.",
    // A wordmark: sized by width in the logo tile.
    logo: ({ className }) => <RimeLogo className={className ?? "h-auto w-6"} />,
    tileClassName: "h-auto w-9",
    keysUrl: KEY_PAGES.rime,
    keysPlace: "Rime's dashboard",
    keysWhere: "API tokens",
    keysHow: "From Rime's dashboard, under API tokens.",
    options: {},
    // Results of tasks can fail to reach Prism with LiveKit's Rime plugin 1.8.11
    // (docs/rime-notes.md#the-plugin); experimental until the plugin handles them.
    experimental: true,
  },
}

/** In the order the core lists them. */
export const PROVIDER_ORDER: VoiceProvider[] = ["gemini", "openai", "rime"]
