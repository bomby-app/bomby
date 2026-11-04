import { LoaderCircle } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * A settings checklist's Check again, with a spinner while it checks. Disabled only then,
 * so a failed first read can always be retried.
 */
export function CheckAgainButton({
  checking,
  onClick,
}: {
  checking: boolean
  onClick: () => void
}) {
  return (
    <Button variant="outline" disabled={checking} onClick={onClick}>
      {checking && <LoaderCircle className="animate-spin" />}
      {checking ? "Checking..." : "Check again"}
    </Button>
  )
}
