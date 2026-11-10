import { Badge } from "@/components/ui/badge"

/**
 * The small bubblegum Beta badge (ink text) that follows the wordmark while Bomby is in beta
 * (docs/brand.md): in the main sidebar and in Settings, About.
 */
export function BetaBadge() {
  return (
    <Badge className="h-4 bg-claude px-1.5 font-mono text-label font-semibold text-claude-foreground uppercase">
      Beta
    </Badge>
  )
}
