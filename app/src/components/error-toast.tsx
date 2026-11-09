import { toast } from "sonner"

import { MascotCard } from "./mascot-card"

/** An error as a toast with the error card's look, for a screen with no room for a card (the splash). */
export function showErrorToast(message: string) {
  toast.custom(
    () => (
      <MascotCard
        state="failed"
        headline={message}
        announce="alert"
        className="w-[356px] shadow-lg"
      />
    ),
    { duration: 8000 }
  )
}
