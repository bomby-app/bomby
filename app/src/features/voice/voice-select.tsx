import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import type { ProviderSettings } from "./api"
import { PROVIDERS } from "./providers"

/**
 * The provider's voices: a 44px trigger with the voice's name and how it sounds, then a list
 * under the provider's name, two lines a voice, with a fixed slot for the check and Default
 * on the provider's own default (Paper, voice-provider-feature).
 */
export function VoiceSelect({
  id,
  provider,
  onChange,
}: {
  id: string
  provider: ProviderSettings
  onChange: (voice: string) => void
}) {
  const current = provider.voices.find((v) => v.id === provider.voice)
  const name = PROVIDERS[provider.provider].name

  return (
    <Select value={provider.voice} onValueChange={onChange}>
      <SelectTrigger
        id={id}
        className="w-full gap-2.5 pr-2.5 pl-3 data-[size=default]:h-11 *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:flex-1 *:data-[slot=select-value]:gap-2.5 data-[state=open]:border-foreground data-[state=open]:ring-3 data-[state=open]:ring-foreground/12"
      >
        <SelectValue>
          <VoiceDot />
          <span className="font-medium">{current?.name}</span>
          <span className="min-w-0 truncate text-muted-foreground">
            {current?.description}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-80 p-1.5">
        <SelectGroup className="p-0">
          <SelectLabel className="px-2.5 pt-1.5 pb-1 font-mono text-label text-muted-foreground uppercase">
            {name} voices
          </SelectLabel>
          {provider.voices.map((voice) => (
            <SelectItem
              key={voice.id}
              value={voice.id}
              textValue={voice.name}
              // Two lines, the check in its own slot on the right.
              className="py-2 pr-9 pl-2.5 *:first:right-2.5 focus:bg-muted data-[state=checked]:bg-muted *:[span]:last:flex-col *:[span]:last:items-start *:[span]:last:gap-px"
            >
              <span className="flex items-center gap-2 font-medium">
                {voice.name}
                {voice.id === provider.defaultVoice && (
                  <span className="rounded-full border bg-background px-1.5 py-px text-label font-medium text-muted-foreground">
                    Default
                  </span>
                )}
              </span>
              <span className="text-muted-foreground">{voice.description}</span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

/** The trigger's small round mark: a voice. */
function VoiceDot() {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
      <svg
        viewBox="0 0 24 24"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M6 9v6M10 6v12M14 8v8M18 10v4" />
      </svg>
    </span>
  )
}
