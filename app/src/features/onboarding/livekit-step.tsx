import { Laptop } from "lucide-react"
import type { ReactNode } from "react"

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { LiveKitServer } from "@/features/credentials/api"
import { LiveKitLogo } from "@/features/setup/provider-logos"
import { cn } from "@/lib/utils"

import { SetupCard, StepHeading, Tile } from "./setup-card"

const CHOICES: {
  value: LiveKitServer
  tile: ReactNode
  name: string
  detail: string
}[] = [
  {
    value: "thisMac",
    tile: <Laptop />,
    name: "On this Mac",
    detail: "Nothing to set up",
  },
  {
    value: "theirs",
    tile: <LiveKitLogo />,
    name: "LiveKit Cloud",
    detail: "Your own project and its keys",
  },
]

/**
 * The splash step between the agent and the keys: where calls' LiveKit runs
 * (docs/decisions/livekit-on-this-mac-or-cloud.md). One card is always selected; the round
 * arrow goes on with it (`splash.tsx`).
 */
export function LiveKitStep({
  value,
  onChange,
}: {
  value: LiveKitServer
  onChange: (value: LiveKitServer) => void
}) {
  return (
    <div className="flex flex-col items-center">
      <StepHeading
        title="Where should calls run?"
        body="I can run LiveKit right here on your Mac, or use your own LiveKit Cloud."
      />
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as LiveKitServer)}
        className="mt-7 w-auto gap-3"
      >
        {CHOICES.map((choice) => (
          <label key={choice.value} htmlFor={`server-${choice.value}`}>
            <SetupCard
              className={cn(
                "cursor-default transition-colors",
                value === choice.value && "border-primary"
              )}
              tile={<Tile>{choice.tile}</Tile>}
              name={choice.name}
              status={
                <span className="font-mono text-xs leading-4 text-foreground/55">
                  {choice.detail}
                </span>
              }
              action={
                <RadioGroupItem
                  id={`server-${choice.value}`}
                  value={choice.value}
                  className="mr-1 size-5"
                />
              }
            />
          </label>
        ))}
      </RadioGroup>
    </div>
  )
}
