import { Toaster as Sonner, type ToasterProps } from "sonner"

import { useDarkMode } from "@/hooks/use-dark-mode"

// shadcn's Toaster, on our theme hook instead of next-themes.
const Toaster = ({ ...props }: ToasterProps) => {
  const dark = useDarkMode()

  return (
    <Sonner
      theme={dark ? "dark" : "light"}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
