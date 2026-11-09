import { Maximize2 } from "lucide-react"
import { type KeyboardEvent, useEffect, useRef, useState } from "react"

import { ShortcutKeys } from "@/components/shortcut-keys"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import {
  removeTodo,
  type Todo,
  type TodoChange,
  type TodoStatus,
  updateTodo,
} from "./api"
import { bombyLine, GROUPS, STATUS_LABEL } from "./labels"
import { fits, NOTES_MAX, TITLE_MAX } from "./limits"
import { StatusMark } from "./status-mark"
import { EXPAND_SHORTCUT, Left, SAVE_SHORTCUT, TodoDialog } from "./todo-dialog"
import type { Draft } from "./view-state"

/**
 * One to-do (Paper "extensions", 03 and 04): its status mark, which opens a menu of
 * statuses; its words, notes (their first lines, as written) and, when Bomby changed it
 * last, who and when; its number, the one Bomby says. Clicking the words edits it in
 * place, and the expand button, or Cmd-E while editing, opens it in the dialog with room
 * for longer notes. The words being edited live in the panel's state (`view-state.ts`), so
 * a remount keeps them.
 */
export function TodoRow({
  projectId,
  todo,
  draft,
  onDraft,
  onError,
}: {
  projectId: number
  todo: Todo
  /** Its words being edited, while it is. */
  draft: Draft | null
  onDraft: (draft: Draft | null) => void
  onError: (error: string | null) => void
}) {
  function setStatus(status: TodoStatus) {
    onError(null)
    updateTodo(projectId, todo.number, { status }, "user").catch((e: unknown) =>
      onError(String(e))
    )
  }

  if (draft && !draft.expanded) {
    return (
      <TodoEditor
        projectId={projectId}
        todo={todo}
        draft={draft}
        onDraft={onDraft}
        onError={onError}
      />
    )
  }

  function edit(expanded: boolean) {
    onDraft({
      number: todo.number,
      title: todo.title,
      notes: todo.notes,
      was: { title: todo.title, notes: todo.notes },
      expanded,
    })
  }

  const line = bombyLine(todo)
  const closed = todo.status === "done" || todo.status === "cancelled"
  return (
    <div className="group/todo flex items-start gap-2.5 rounded-md p-2 hover:bg-accent/60">
      <StatusMenu status={todo.status} onChange={setStatus} />
      <button
        type="button"
        onClick={() => edit(false)}
        className="flex min-w-0 flex-1 flex-col gap-1 rounded-sm text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span
          className={cn(
            "text-sm font-medium break-words",
            closed && "font-normal text-muted-foreground",
            todo.status === "cancelled" && "line-through"
          )}
        >
          {todo.title}
        </span>
        {todo.notes && (
          <span className="line-clamp-3 text-xs/5 break-words whitespace-pre-wrap text-muted-foreground">
            {todo.notes}
          </span>
        )}
        {line && <span className="text-xs text-muted-foreground">{line}</span>}
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Expand"
            onClick={() => edit(true)}
            className="-my-0.5 opacity-0 group-hover/todo:opacity-100 focus-visible:opacity-100"
          >
            <Maximize2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Expand</TooltipContent>
      </Tooltip>
      <span className="w-7 shrink-0 text-right font-mono text-xs leading-5 text-muted-foreground tabular-nums">
        {todo.number}
      </span>
      {draft?.expanded && (
        <ExpandedEditor
          projectId={projectId}
          todo={todo}
          draft={draft}
          onDraft={onDraft}
        />
      )}
    </div>
  )
}

/** What the user changed in a to-do since editing began, with a status picked meanwhile. */
function changeOf(todo: Todo, draft: Draft, status?: TodoStatus): TodoChange {
  const { title, notes, was } = draft
  const change: TodoChange = {}
  if (title !== was.title) change.title = title
  if (notes !== was.notes) change.notes = notes
  if (status !== undefined && status !== todo.status) change.status = status
  return change
}

/** A to-do being edited in the dialog: saves what changed and closes; Cancel drops it. */
function ExpandedEditor({
  projectId,
  todo,
  draft,
  onDraft,
}: {
  projectId: number
  todo: Todo
  draft: Draft
  onDraft: (draft: Draft | null) => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const change = changeOf(todo, draft)
    if (Object.keys(change).length === 0) return onDraft(null)
    setSaving(true)
    setError(null)
    try {
      await updateTodo(projectId, todo.number, change, "user")
      onDraft(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <TodoDialog
      heading={`To-do ${todo.number}`}
      words={draft}
      was={draft.was}
      onWords={(words) => onDraft({ ...draft, ...words })}
      onSubmit={() => void save()}
      onCancel={() => onDraft(null)}
      submitLabel="Save"
      busy={saving}
      error={error}
      focus="notes"
    />
  )
}

/** The status mark as a button that opens the statuses. */
function StatusMenu({
  status,
  onChange,
}: {
  status: TodoStatus
  onChange: (status: TodoStatus) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Status: ${STATUS_LABEL[status]}`}
          className="flex size-5 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <StatusMark status={status} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuRadioGroup
          value={status}
          onValueChange={(next) => onChange(next as TodoStatus)}
        >
          {GROUPS.map((each) => (
            <DropdownMenuRadioItem key={each} value={each} className="gap-2.5">
              <StatusMark status={each} />
              {STATUS_LABEL[each]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * A to-do being edited in its row: its words and notes, saved with Return in the words,
 * Cmd-Return anywhere, Save, or a status picked from its mark; Return in the notes starts
 * a line, Cmd-E opens the dialog, Esc cancels. Saves only what the user changed since
 * editing began, so a change Bomby made meanwhile to the rest stays.
 */
function TodoEditor({
  projectId,
  todo,
  draft,
  onDraft,
  onError,
}: {
  projectId: number
  todo: Todo
  draft: Draft
  onDraft: (draft: Draft | null) => void
  onError: (error: string | null) => void
}) {
  const { title, notes } = draft
  const [saving, setSaving] = useState(false)
  const titleField = useRef<HTMLInputElement>(null)

  // Editing starts in its words.
  useEffect(() => {
    titleField.current?.focus()
  }, [])

  function close() {
    onDraft(null)
  }

  async function run(work: () => Promise<unknown>) {
    if (saving) return
    setSaving(true)
    onError(null)
    try {
      await work()
      close()
    } catch (e) {
      onError(String(e))
    } finally {
      setSaving(false)
    }
  }

  /** Saves what the user changed, with a status picked here, and closes. */
  function save(status?: TodoStatus) {
    const change = changeOf(todo, draft, status)
    if (Object.keys(change).length === 0) return close()
    if (!fits(draft, draft.was)) return
    void run(() => updateTodo(projectId, todo.number, change, "user"))
  }

  /** Esc cancels, Cmd-Return saves, Cmd-E expands, from the words or the notes. */
  function onKeyDown(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing) return
    if (event.key === "Escape") {
      event.preventDefault()
      close()
    } else if (SAVE_SHORTCUT.matches(event.nativeEvent)) {
      event.preventDefault()
      save()
    } else if (EXPAND_SHORTCUT.matches(event.nativeEvent)) {
      event.preventDefault()
      onDraft({ ...draft, expanded: true })
    }
  }

  /** In the words, Return saves too. */
  function onTitleKeyDown(event: KeyboardEvent) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault()
      save()
    } else {
      onKeyDown(event)
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
      className="flex flex-col gap-2.5 rounded-lg bg-background p-2.5 ring-1 ring-foreground"
    >
      <div className="flex items-start gap-2.5">
        <StatusMenu status={todo.status} onChange={save} />
        <Input
          aria-label="To-do"
          ref={titleField}
          value={title}
          onKeyDown={onTitleKeyDown}
          onChange={(e) => onDraft({ ...draft, title: e.target.value })}
          className="h-auto flex-1 border-0 p-0 text-sm font-medium shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <Left text={title} max={TITLE_MAX} className="leading-5" />
        <span className="w-7 shrink-0 text-right font-mono text-xs leading-5 text-muted-foreground tabular-nums">
          {todo.number}
        </span>
      </div>
      <div className="ml-7.5 flex flex-col gap-1">
        <Textarea
          aria-label="Notes"
          placeholder="Add notes"
          value={notes}
          onKeyDown={onKeyDown}
          onChange={(e) => onDraft({ ...draft, notes: e.target.value })}
          className="max-h-60 min-h-14 resize-none rounded-md border-0 bg-muted px-2 py-1.5 shadow-none focus-visible:ring-0 dark:bg-muted"
        />
        <Left text={notes} max={NOTES_MAX} className="self-end" />
      </div>
      <div className="ml-7.5 flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Expand"
              className="-ml-1.5"
              onClick={() => onDraft({ ...draft, expanded: true })}
            >
              <Maximize2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Expand
            <ShortcutKeys shortcut={EXPAND_SHORTCUT} />
          </TooltipContent>
        </Tooltip>
        <span className="flex flex-1 items-center gap-1.5 text-xs text-muted-foreground">
          <ShortcutKeys shortcut={SAVE_SHORTCUT} /> saves · Esc cancels
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving}
          className="text-destructive hover:text-destructive"
          onClick={() => void run(() => removeTodo(projectId, todo.number))}
        >
          Delete
        </Button>
        <Button
          type="submit"
          variant="highlighter"
          size="sm"
          disabled={saving || !fits(draft, draft.was)}
        >
          Save
        </Button>
      </div>
    </form>
  )
}
