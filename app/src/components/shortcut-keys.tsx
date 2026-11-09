import { Kbd, KbdGroup } from "@/components/ui/kbd"
import type { Shortcut } from "@/lib/shortcuts"

/** A shortcut's keys as a Kbd group, for menus, tooltips and hints. */
export function ShortcutKeys({
  shortcut,
  className,
}: {
  shortcut: Shortcut
  className?: string
}) {
  return (
    <KbdGroup className={className}>
      {shortcut.keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  )
}
