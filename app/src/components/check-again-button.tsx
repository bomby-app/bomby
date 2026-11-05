import { LoaderCircle } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * A settings checklist's Check again, with a spinner while it checks. Disabled only then,
 * so a failed first read can always be retried. `label` and `checkingLabel` name what a
 * section checks (Agents: Refresh models).
 */
export function CheckAgainButton({
  checking,
  onClick,
  label = "Check again",
  checkingLabel = "Checking...",
}: {
  checking: boolean
  onClick: () => void
  label?: string
  checkingLabel?: string
}) {
  return (
    <Button variant="outline" disabled={checking} onClick={onClick}>
      {checking && <LoaderCircle className="animate-spin" />}
      {checking ? checkingLabel : label}
    </Button>
  )
}
