import { type FormEvent, type KeyboardEvent, useRef } from "react"

import { ShortcutKeys } from "@/components/shortcut-keys"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

import { Left, SAVE_SHORTCUT } from "./editing"
import { fits, NOTES_MAX, TITLE_MAX } from "./limits"
import type { Words } from "./view-state"

/**
 * A to-do's title and notes with room to write, for a new one with notes (the + by the
 * field that adds one) and for one being edited, expanded from its row. Return in the
 * title goes on to the notes, where it starts a line; Cmd-Return saves; Esc or Cancel
 * closes. A click outside keeps it open, so a stray one loses no words.
 */
export function TodoDialog({
  heading,
  words,
  was,
  onWords,
  onSubmit,
  onCancel,
  submitLabel,
  busy,
  error,
  focus = "title",
}: {
  heading: string
  words: Words
  /** What they were when editing began, for one being edited. */
  was?: Words
  onWords: (words: Words) => void
  onSubmit: () => void
  onCancel: () => void
  submitLabel: string
  busy: boolean
  error: string | null
  /** Where the cursor starts: the title, or the end of the notes. */
  focus?: "title" | "notes"
}) {
  const titleField = useRef<HTMLInputElement>(null)
  const notesField = useRef<HTMLTextAreaElement>(null)
  const ready = fits(words, was) && !busy

  function submit(event?: FormEvent) {
    event?.preventDefault()
    if (ready) onSubmit()
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing) return
    if (SAVE_SHORTCUT.matches(event.nativeEvent)) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="gap-0 p-0 sm:max-w-lg"
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          const field = focus === "notes" ? notesField : titleField
          const end = field.current?.value.length ?? 0
          field.current?.focus()
          field.current?.setSelectionRange(end, end)
        }}
      >
        <form onSubmit={submit} className="flex flex-col">
          <DialogHeader className="px-4 pt-4">
            <DialogTitle className="font-mono text-label font-medium text-muted-foreground uppercase">
              {heading}
            </DialogTitle>
            <DialogDescription className="sr-only">
              The to-do's title, and notes to keep with it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 px-4 pt-3 pb-4">
            <div className="flex items-baseline gap-3">
              <Input
                ref={titleField}
                aria-label="To-do"
                placeholder="What's to do?"
                value={words.title}
                onChange={(e) => onWords({ ...words, title: e.target.value })}
                onKeyDown={(event) => {
                  onKeyDown(event)
                  if (
                    !event.defaultPrevented &&
                    event.key === "Enter" &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault()
                    notesField.current?.focus()
                  }
                }}
                className="h-auto flex-1 border-0 p-0 text-base font-medium shadow-none focus-visible:ring-0 md:text-base dark:bg-transparent"
              />
              <Left text={words.title} max={TITLE_MAX} />
            </div>
            <Textarea
              ref={notesField}
              aria-label="Notes"
              placeholder="Add notes"
              value={words.notes}
              onKeyDown={onKeyDown}
              onChange={(e) => onWords({ ...words, notes: e.target.value })}
              className="max-h-[50vh] min-h-40 resize-none rounded-none border-0 p-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            <Left text={words.notes} max={NOTES_MAX} className="self-end" />
            {error && <FieldError>{error}</FieldError>}
          </div>
          <DialogFooter className="mx-0 mb-0 items-center sm:justify-between">
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
              <ShortcutKeys shortcut={SAVE_SHORTCUT} /> saves · Esc cancels
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onCancel}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="highlighter"
                size="sm"
                disabled={!ready}
              >
                {submitLabel}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
