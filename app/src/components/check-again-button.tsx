import { LoaderCircle } from "lucide-react"

import { Button } from "@/components/ui/button"

/** A settings checklist's Check again, with a spinner while it checks. */
export function CheckAgainButton({
  checking,
  disabled,
  onClick,
}: {
  checking: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Button variant="outline" disabled={checking || disabled} onClick={onClick}>
      {checking && <LoaderCircle className="animate-spin" />}
      {checking ? "Checking..." : "Check again"}
    </Button>
  )
}
