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
      title: "Local",
      description: "Runs on this Mac. Nothing to set up.",
    },
    {
      value: "theirs",
      title: "Cloud",
      description: "Your own LiveKit Cloud project and its keys.",
    },
  ]

/** Applies from the next call; one under way keeps its server. */
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
