import { LoaderCircle } from "lucide-react"
import type { ComponentProps } from "react"

import { Button } from "@/components/ui/button"

import { installAdaptersNow, useAdapterInstall } from "./use-adapter-install"

/**
 * Installs the ACP adapter an agent needs (docs/decisions/install-adapters-on-setup.md).
 * Bubblegum, like every button to something a call still needs (docs/brand.md).
 */
export function SetUpButton({
  children = "Set up",
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick">) {
  const { installing: working } = useAdapterInstall()
  return (
    <Button
      size="sm"
      variant="claude"
      {...props}
      disabled={working}
      onClick={() => void installAdaptersNow()}
    >
      {working && <LoaderCircle className="animate-spin" />}
      {/* One label for the whole install, however many steps it takes (owner, 2026-11-05). */}
      {working ? "Setting up..." : children}
    </Button>
  )
}
