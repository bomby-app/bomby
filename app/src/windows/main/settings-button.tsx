import { Settings } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { openSettings, SETTINGS_SHORTCUT } from "../settings/open-settings"

/** The gear in the sidebar footer; its tooltip shows the shortcut. */
export function SettingsButton() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Settings"
          onClick={() => void openSettings()}
        >
          <Settings />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        Settings
        <KbdGroup>
          {SETTINGS_SHORTCUT.keys.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </KbdGroup>
      </TooltipContent>
    </Tooltip>
  )
}
