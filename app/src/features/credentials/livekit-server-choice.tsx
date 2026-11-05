import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

import type { LiveKitServer } from "./api"
import { chooseLiveKitServer, useSavedKeys } from "./use-saved-keys"

const CHOICES: { value: LiveKitServer; title: string; description: string }[] =
  [
    {
      value: "thisMac",
      title: "On this Mac",
      description: "Bomby runs LiveKit itself. Nothing to set up.",
    },
    {
      value: "theirs",
      title: "LiveKit Cloud or your own server",
      description:
        "Your own keys. LiveKit Cloud adds Krisp noise cancellation.",
    },
  ]

/**
 * Where calls' LiveKit server runs (docs/decisions/livekit-on-this-mac-or-cloud.md). A
 * change applies from the next call; one under way keeps its server.
 */
export function LiveKitServerChoice() {
  const { keys } = useSavedKeys()
  if (!keys) return null

  return (
    <RadioGroup
      value={keys.server}
      onValueChange={(value) =>
        void chooseLiveKitServer(value as LiveKitServer)
      }
    >
      {CHOICES.map((choice) => (
        <FieldLabel key={choice.value} htmlFor={`livekit-${choice.value}`}>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>{choice.title}</FieldTitle>
              <FieldDescription>{choice.description}</FieldDescription>
            </FieldContent>
            <RadioGroupItem
              value={choice.value}
              id={`livekit-${choice.value}`}
            />
          </Field>
        </FieldLabel>
      ))}
    </RadioGroup>
  )
}
