import { type KeyboardEvent, useEffect, useRef, useState } from "react"

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
import { cn } from "@/lib/utils"

import { removeTodo, type Todo, type TodoStatus, updateTodo } from "./api"
import { bombyLine, GROUPS, STATUS_LABEL } from "./labels"
import { StatusMark } from "./status-mark"

/**
 * One to-do (Paper "extensions", 03 and 04): its status mark, which opens a menu of
 * statuses; its words, notes and, when Bomby changed it last, who and when; its number,
 * the one Bomby says. Clicking the words edits it in place.
 */
export function TodoRow({
  projectId,
  todo,
  editing,
  onEdit,
  onError,
}: {
  projectId: number
  todo: Todo
  editing: boolean
  onEdit: (editing: boolean) => void
  onError: (error: string | null) => void
}) {
  function setStatus(status: TodoStatus) {
    onError(null)
    updateTodo(projectId, todo.number, { status }, "user").catch((e: unknown) =>
      onError(String(e))
    )
  }

  if (editing) {
    return (
      <TodoEditor
        projectId={projectId}
        todo={todo}
        onClose={() => onEdit(false)}
        onError={onError}
        onStatus={setStatus}
      />
    )
  }

  const line = bombyLine(todo)
  const closed = todo.status === "done" || todo.status === "cancelled"
  return (
    <div className="group/todo flex items-start gap-2.5 rounded-md p-2 hover:bg-accent/60">
      <StatusMenu status={todo.status} onChange={setStatus} />
      <button
        type="button"
        onClick={() => onEdit(true)}
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
          <span className="line-clamp-2 text-xs text-muted-foreground">
            {todo.notes}
          </span>
        )}
        {line && <span className="text-xs text-muted-foreground">{line}</span>}
      </button>
      <span className="w-7 shrink-0 text-right font-mono text-xs leading-5 text-muted-foreground tabular-nums">
        {todo.number}
      </span>
    </div>
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

/** A to-do being edited: its words and notes, saved with Return or Save; Esc cancels. */
function TodoEditor({
  projectId,
  todo,
  onClose,
  onError,
  onStatus,
}: {
  projectId: number
  todo: Todo
  onClose: () => void
  onError: (error: string | null) => void
  onStatus: (status: TodoStatus) => void
}) {
  const [title, setTitle] = useState(todo.title)
  const [notes, setNotes] = useState(todo.notes)
  const [busy, setBusy] = useState(false)
  const titleField = useRef<HTMLInputElement>(null)

  // Editing starts in its words.
  useEffect(() => {
    titleField.current?.focus()
  }, [])

  async function run(work: () => Promise<unknown>) {
    onError(null)
    setBusy(true)
    try {
      await work()
      onClose()
    } catch (e) {
      onError(String(e))
    } finally {
      setBusy(false)
    }
  }

  function save() {
    if (title === todo.title && notes === todo.notes) return onClose()
    void run(() => updateTodo(projectId, todo.number, { title, notes }, "user"))
  }

  /** Esc cancels; Return saves, from the notes too (Shift-Return there starts a line). */
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault()
      onClose()
    } else if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault()
      save()
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
        <StatusMenu status={todo.status} onChange={onStatus} />
        <Input
          aria-label="To-do"
          ref={titleField}
          value={title}
          onKeyDown={onKeyDown}
          onChange={(e) => setTitle(e.target.value)}
          className="h-auto flex-1 border-0 p-0 text-sm font-medium shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <span className="w-7 shrink-0 text-right font-mono text-xs leading-5 text-muted-foreground tabular-nums">
          {todo.number}
        </span>
      </div>
      <Textarea
        aria-label="Notes"
        placeholder="Notes"
        value={notes}
        rows={2}
        onKeyDown={onKeyDown}
        onChange={(e) => setNotes(e.target.value)}
        className="ml-7.5 min-h-0 w-auto resize-none border-0 p-0 text-sm text-muted-foreground shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="ml-7.5 flex items-center gap-2">
        <span className="flex-1 text-xs text-muted-foreground">
          Return saves · Esc cancels
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          className="text-destructive hover:text-destructive"
          onClick={() => void run(() => removeTodo(projectId, todo.number))}
        >
          Delete
        </Button>
        <Button
          type="submit"
          variant="highlighter"
          size="sm"
          disabled={busy || !title.trim()}
        >
          Save
        </Button>
      </div>
    </form>
  )
}
