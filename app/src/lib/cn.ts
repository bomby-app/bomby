import { createCn } from "cn/config"

/* cn() with Bomby's own theme names (src/index.css). Without them cn reads `text-label`
   as a text colour and `shadow-float` as a shadow colour, so `text-label
   text-muted-foreground` would drop the size. vite.config.ts points every
   `import { cn } from "cn"` here, generated components included. */
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: ["label", "lead", "title", "display"] }],
      shadow: [{ shadow: ["card", "float", "primary"] }],
    },
  },
})
