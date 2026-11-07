import { ListTodo, Plus, Search } from "lucide-react"
import { type FormEvent, useState } from "react"

import { Mascot } from "@/components/mascot"
import { FieldError } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { addTodos, type Todo, type TodoStatus } from "./api"
import { type Filter, FILTERS, found, matches } from "./filters"
import { FILTER_LABEL, GROUPS, ordered, STATUS_LABEL } from "./labels"
import { StatusMark } from "./status-mark"
import { TodoRow } from "./todo-row"
import { useTodos } from "./use-todos"

/** The workspace panel's To-dos tab, but for its count and content (`main-panel.tsx`). */
export const TODOS_TAB = {
  id: "todos",
  label: "To-dos",
  icon: <ListTodo />,
}

/** How many of a project's to-dos are open (to do or doing), for its tab and button. */
export function useOpenCount(projectId: number): number {
  const { todos } = useTodos(projectId)
  return todos?.filter((t) => matches(t, "open")).length ?? 0
}

/**
 * A project's to-dos, as the workspace panel's To-dos tab shows them (Paper "extensions",
 * 03 and 04): search and a status filter, a field to add one, then the list by status.
 * Open shows doing and to do, with what's done folded under them. Bomby's changes land
 * here as they happen (`use-todos.ts`).
 */
export function TodosView({ projectId }: { projectId: number }) {
  const { todos, error: readError } = useTodos(projectId)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<Filter>("open")
  const [showDone, setShowDone] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!todos) {
    return readError ? (
      <FieldError className="m-4">{readError}</FieldError>
    ) : null
  }

  const shown = todos.filter((t) => matches(t, filter) && found(t, search))
  const groups = GROUPS.filter(
    (status) => filter !== "open" || status === "todo" || status === "doing"
  )
    .map((status) => ({ status, todos: ordered(shown, status) }))
    .filter((group) => group.todos.length > 0)
  const done = ordered(
    todos.filter((t) => found(t, search)),
    "done"
  )

  function row(todo: Todo) {
    return (
      <TodoRow
        key={todo.number}
        projectId={projectId}
        todo={todo}
        editing={editing === todo.number}
        onEdit={(on) => setEditing(on ? todo.number : null)}
        onError={setError}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-2 px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <InputGroup className="h-8 flex-1">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Search to-dos"
              placeholder="Search to-dos"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </InputGroup>
          <Select
            value={filter}
            onValueChange={(next) => setFilter(next as Filter)}
          >
            <SelectTrigger size="sm" aria-label="Show" className="w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              {FILTERS.map((each, index) => (
                <FilterItem
                  key={each}
                  filter={each}
                  count={todos.filter((t) => matches(t, each)).length}
                  separated={index === 2}
                />
              ))}
            </SelectContent>
          </Select>
        </div>
        <AddTodo projectId={projectId} onError={setError} />
        {error && <FieldError>{error}</FieldError>}
      </div>

      {todos.length === 0 ? (
        <Empty />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col px-2 pb-3">
            {groups.map((group) => (
              <section key={group.status} className="flex flex-col">
                <GroupLabel status={group.status} count={group.todos.length} />
                {group.todos.map(row)}
              </section>
            ))}
            {groups.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                No to-dos match.
              </p>
            )}
            {filter === "open" && done.length > 0 && (
              <div className="mt-2 flex flex-col border-t pt-1">
                <button
                  type="button"
                  aria-expanded={showDone}
                  onClick={() => setShowDone(!showDone)}
                  className="flex h-9 items-center gap-2.5 rounded-md px-2 text-left text-sm outline-none hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="flex size-5 items-center justify-center">
                    <StatusMark status="done" />
                  </span>
                  <span className="flex-1 text-muted-foreground">
                    {done.length} done
                  </span>
                  <span className="font-medium">
                    {showDone ? "Hide" : "Show"}
                  </span>
                </button>
                {showDone && done.map(row)}
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

/** One filter in the status menu, with how many to-dos it has. */
function FilterItem({
  filter,
  count,
  separated,
}: {
  filter: Filter
  count: number
  separated: boolean
}) {
  return (
    <>
      {separated && <SelectSeparator />}
      <SelectItem value={filter}>
        {FILTER_LABEL[filter]}
        <span className="ml-auto pl-4 font-mono text-xs text-muted-foreground tabular-nums">
          {count}
        </span>
      </SelectItem>
    </>
  )
}

function GroupLabel({ status, count }: { status: TodoStatus; count: number }) {
  return (
    <h3 className="flex items-center gap-2 px-2 pt-3 pb-1 font-mono text-label text-muted-foreground uppercase">
      {STATUS_LABEL[status]}
      <span className="tabular-nums">{count}</span>
    </h3>
  )
}

/** The field that adds a to-do: Return adds it, as the user's. */
function AddTodo({
  projectId,
  onError,
}: {
  projectId: number
  onError: (error: string | null) => void
}) {
  const [title, setTitle] = useState("")
  const [adding, setAdding] = useState(false)

  async function add(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    onError(null)
    setAdding(true)
    try {
      await addTodos(projectId, [{ title }], "user")
      setTitle("")
    } catch (e) {
      onError(String(e))
    } finally {
      setAdding(false)
    }
  }

  return (
    <form onSubmit={(event) => void add(event)}>
      <InputGroup className="h-9 border-transparent bg-muted shadow-none has-[[data-slot=input-group-control]:focus-visible]:bg-background dark:bg-muted">
        <InputGroupAddon>
          <Plus />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Add a to-do"
          placeholder="Add a to-do"
          value={title}
          disabled={adding}
          onChange={(e) => setTitle(e.target.value)}
        />
      </InputGroup>
    </form>
  )
}

/** No to-dos yet (Paper "extensions", 04 E). */
function Empty() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-10 pb-16 text-center">
      <Mascot state="idle" size={40} />
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold">Nothing to do yet.</p>
        <p className="text-sm text-muted-foreground">
          Add one above, or just tell Bomby on a call.
        </p>
      </div>
    </div>
  )
}
