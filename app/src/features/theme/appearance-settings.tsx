import { type LucideIcon, Monitor, Moon, Sun } from "lucide-react"

import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { isTheme, THEMES, type Theme, useTheme } from "./theme-provider"

const OPTIONS: Record<Theme, { label: string; icon: LucideIcon }> = {
  system: { label: "System", icon: Monitor },
  light: { label: "Light", icon: Sun },
  dark: { label: "Dark", icon: Moon },
}

/** The Appearance section of the settings window. */
export function AppearanceSettings() {
  const { theme, setTheme } = useTheme()

  return (
    <FieldGroup>
      <Field>
        <FieldLabel id="theme-label">Theme</FieldLabel>
        <ToggleGroup
          variant="outline"
          aria-labelledby="theme-label"
          value={[theme]}
          // A single-choice group: pressing the current theme again would empty the
          // value, so only a press on another theme changes it.
          onValueChange={([next]) => {
            if (isTheme(next)) setTheme(next)
          }}
        >
          {THEMES.map((value) => {
            const { label, icon: Icon } = OPTIONS[value]
            return (
              <ToggleGroupItem key={value} value={value} className="px-3">
                <Icon />
                {label}
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>
        <FieldDescription>
          System follows your computer's light or dark setting.
        </FieldDescription>
      </Field>
    </FieldGroup>
  )
}
