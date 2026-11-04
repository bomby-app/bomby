import { LoaderCircle } from "lucide-react"
import type { ComponentProps } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import {
  installAdaptersNow,
  installLabel,
  useAdapterInstall,
} from "./use-adapter-install"

/**
 * Installs the ACP adapter an agent needs (docs/decisions/install-adapters-on-setup.md).
 * Bubblegum, like every button to something a call still needs (docs/brand.md).
 */
export function SetUpButton({
  className,
  children = "Set up",
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick">) {
  const { step } = useAdapterInstall()
  const working = step !== null
  return (
    <Button
      size="sm"
      {...props}
      disabled={working}
      className={cn(
        "bg-claude text-claude-foreground hover:bg-claude/85",
        className
      )}
      onClick={() => void installAdaptersNow()}
    >
      {working && <LoaderCircle className="animate-spin" />}
      {working ? installLabel(step) : children}
    </Button>
  )
}
