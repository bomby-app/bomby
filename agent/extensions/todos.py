"""To-dos: a list for each project that the user and Bomby keep together. The app keeps it
(its `todos` table) and shows it beside the call; the voice model keeps it with four tools,
which reach the app over RPC (`bridge.py`): `todos.list`, `todos.add`, `todos.update` and
`todos.remove`.

"To-do", never "task": a task is work handed to a coding agent (`start_task`).

The app sends the open to-dos when the call starts (`TodosData`), so the model knows the
list from the first word; the tools always read and write the list as it is now.
"""

from typing import ClassVar, Literal, final, override

from livekit.agents.llm import ToolError, Toolset, function_tool
from pydantic import BaseModel, ConfigDict, JsonValue, TypeAdapter, ValidationError

from sections import Style, join
from voice_providers import Tools

from .extension import Extension, ExtensionContext, ExtensionError

Status = Literal["todo", "doing", "done", "cancelled"]
Filter = Literal["open", "all", "todo", "doing", "done", "cancelled"]

STATUS_WORDS: dict[Status, str] = {
    "todo": "to do",
    "doing": "doing",
    "done": "done",
    "cancelled": "cancelled",
}
FILTER_WORDS: dict[Filter, str] = {
    "open": "open",
    "all": "",
    "todo": "still to do",
    "doing": "being done",
    "done": "done",
    "cancelled": "cancelled",
}
# The most `add_todos` takes at once; the core holds the same limit.
MAX_ADD = 20


class Todo(BaseModel):
    """One to-do as the app sends it. Fields Bomby doesn't read are ignored."""

    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True, extra="ignore")

    number: int
    title: str
    notes: str = ""
    status: Status


class TodosData(BaseModel):
    """What the app sends for the extension when a call starts: the open to-dos, the most
    recent first, and how many more are open beyond them."""

    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True, extra="ignore")

    open: tuple[Todo, ...] = ()
    more: int = 0


class Listing(BaseModel):
    """What `todos.list` answers: the to-dos asked for, oldest first, and how many older
    ones were left out to keep the answer within LiveKit's RPC limit."""

    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True, extra="ignore")

    todos: tuple[Todo, ...]
    omitted: int = 0


TODO = TypeAdapter(Todo)
TODOS = TypeAdapter(list[Todo])
LISTING = TypeAdapter(Listing)


def line(todo: Todo, style: Style, notes: bool = False) -> str:
    """ "5: Fix the reminders (doing)", the number first so the model can name it."""
    status = "" if todo.status == "todo" else f" ({STATUS_WORDS[todo.status]})"
    extra = f" Notes: {todo.notes}" if notes and todo.notes else ""
    return f"{style.code(str(todo.number))}: {todo.title}{status}{extra}"


def listing(todos: list[Todo], style: Style, notes: bool = False) -> str:
    return "\n".join(style.item(line(t, style, notes)) for t in todos)


def read[T](adapter: TypeAdapter[T], answer: JsonValue) -> T:
    """The app's answer as `T`; an answer of another shape fails the tool, like no answer."""
    try:
        return adapter.validate_python(answer)
    except ValidationError as e:
        raise ToolError("The to-do list answered with something unexpected.") from e


@final
class Todos(Extension):
    id = "todos"
    name = "To-dos"
    description = "A list for each project that you and Bomby keep together."

    @override
    def note(self, context: ExtensionContext) -> str:
        style = context.style
        try:
            data = TodosData.model_validate(context.data)
        except ValidationError:
            data = TodosData()
        how = (
            "This project has a to-do list that you and the user keep together. It shows "
            "beside the call, and the user changes it too. Use the to-do tools when the "
            "user wants something noted, ticked off, changed or dropped, and read it with "
            f"{style.code('list_todos')} when they ask what's left. A to-do is only a "
            f"note: work still goes to an agent with {style.code('start_task')}. Each "
            "to-do has a number; say it only when it helps the user find one."
        )
        if data.open:
            more = f" and {data.more} more" if data.more else ""
            now = join(
                f"Open when the call started, the newest first{more}:",
                listing(list(data.open), style),
            )
        else:
            now = "Nothing was open on it when the call started."
        return style.section("To-dos", join(how, now))

    @override
    def tools(self, context: ExtensionContext) -> Tools:
        bridge, style = context.bridge, context.style

        async def ask(method: str, payload: dict[str, JsonValue]) -> JsonValue:
            try:
                return await bridge.call(method, payload)
            except ExtensionError as e:
                raise ToolError(str(e)) from e

        @function_tool()
        async def list_todos(status: Filter = "open") -> str:
            """Read this project's to-do list as it is now, with each to-do's number and
            notes.

            Invoke this when the user asks what's on the list or what's left, or before
            changing a to-do you can't place by its number.

            Args:
                status: Which to-dos: "open" (to do and doing, the default), "all", or
                    only those "todo", "doing", "done" or "cancelled".
            """
            answer = read(LISTING, await ask("todos.list", {"status": status}))
            todos, omitted = list(answer.todos), answer.omitted
            total = len(todos) + omitted
            which = FILTER_WORDS[status]
            if total == 0:
                return (
                    f"There are no {which} to-dos." if which else "The list is empty."
                )
            plural = "s" if total > 1 else ""
            count = " ".join(w for w in (str(total), which, f"to-do{plural}") if w)
            if omitted:
                count += (
                    f", too many to send at once: the newest {len(todos)}, the oldest "
                    f"{omitted} left out"
                )
            return join(f"{count}:", listing(todos, style, True))

        @function_tool()
        async def add_todos(items: list[str]) -> str:
            """Add to-dos to the end of this project's list, each one to do.

            Invoke this when the user asks you to note, remember or add something to do,
            one or several at once. Not for work to start now: that's for the agents.

            Args:
                items: Each to-do as a short line in the user's words, under 120
                    characters; at most 20.
            """
            titles = [t.strip() for t in items if t.strip()]
            if not titles:
                raise ToolError("There was nothing to add.")
            if len(titles) > MAX_ADD:
                raise ToolError(f"Add at most {MAX_ADD} to-dos at once.")
            payload: dict[str, JsonValue] = {"items": [{"title": t} for t in titles]}
            added = read(TODOS, await ask("todos.add", payload))
            return join("Added:", listing(added, style))

        @function_tool()
        async def update_todo(
            number: int,
            status: Status | None = None,
            title: str | None = None,
            notes: str | None = None,
        ) -> str:
            """Change one to-do on this project's list: its status, its words or its
            notes. Leave out what stays the same.

            Invoke this when the user ticks one off, starts on it, drops it, or wants it
            worded differently or a detail kept with it.

            Args:
                number: The to-do's number.
                status: "todo", "doing", "done", or "cancelled" for one that won't be done.
                title: Its new words, a short line under 120 characters.
                notes: Details to keep with it, up to 1,000 characters, replacing any it
                    had; empty to clear them.
            """
            change: dict[str, JsonValue] = {"number": number}
            if status is not None:
                change["status"] = status
            if title is not None:
                change["title"] = title
            if notes is not None:
                change["notes"] = notes
            if len(change) == 1:
                raise ToolError("Say what to change: its status, title or notes.")
            todo = read(TODO, await ask("todos.update", change))
            return f"Now {line(todo, style, True)}"

        @function_tool()
        async def remove_todo(number: int) -> str:
            """Delete one to-do from this project's list for good.

            Invoke this only when the user asks to delete or remove it. For one that won't
            be done, set its status to cancelled instead.

            Args:
                number: The to-do's number.
            """
            todo = read(TODO, await ask("todos.remove", {"number": number}))
            return f"Removed {line(todo, style)}"

        return [
            Toolset(id=self.id, tools=[list_todos, add_todos, update_todo, remove_todo])
        ]


TODOS_EXTENSION = Todos()
