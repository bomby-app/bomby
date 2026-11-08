import asyncio
import json
from collections.abc import Callable, Coroutine, Mapping
from typing import cast, final

import pytest
from livekit import rtc
from livekit.agents.llm import FunctionTool, ToolError, Toolset
from pydantic import JsonValue

from extensions import EXTENSIONS, CallExtensions, ExtensionContext, ExtensionError
from extensions.bridge import REFUSED, UNCONFIRMED, UNREACHABLE, RoomBridge
from extensions.catalogue import render
from extensions.todos import TODOS_EXTENSION
from job import JobMetadata
from sections import PLAIN

REMINDERS: dict[str, JsonValue] = {
    "number": 5,
    "title": "Fix the watering reminders",
    "notes": "",
    "status": "doing",
    "createdBy": "bomby",
}
COPY: dict[str, JsonValue] = {
    "number": 6,
    "title": "Rewrite the onboarding copy",
    "notes": "Shorter",
    "status": "todo",
}


@final
class FakeBridge:
    """Answers each method with what `answers` holds for it, and records the calls."""

    def __init__(self, answers: Mapping[str, JsonValue | Exception]) -> None:
        self.answers = answers
        self.calls: list[tuple[str, Mapping[str, JsonValue]]] = []

    async def call(self, method: str, payload: Mapping[str, JsonValue]) -> JsonValue:
        self.calls.append((method, payload))
        answer = self.answers[method]
        if isinstance(answer, Exception):
            raise answer
        return answer


def todo_tools(
    bridge: FakeBridge, context: ExtensionContext | None = None
) -> dict[str, Callable[..., Coroutine[object, object, str]]]:
    context = context or ExtensionContext(bridge=bridge)
    [toolset] = TODOS_EXTENSION.tools(context)
    assert isinstance(toolset, Toolset)
    tools = cast(
        list[FunctionTool[..., Coroutine[object, object, str]]], list(toolset.tools)
    )
    return {
        tool.info.name: cast(Callable[..., Coroutine[object, object, str]], tool)
        for tool in tools
    }


def test_the_todos_tools_are_named_apart_from_tasks() -> None:
    names = set(todo_tools(FakeBridge({})))
    assert names == {"list_todos", "add_todos", "update_todo", "remove_todo"}


def test_listing_names_each_todo_by_number_with_its_status_and_notes() -> None:
    bridge = FakeBridge({"todos.list": {"todos": [REMINDERS, COPY]}})
    result = asyncio.run(todo_tools(bridge)["list_todos"]())

    assert bridge.calls == [("todos.list", {"status": "open"})]
    assert result == (
        "2 open to-dos:\n\n"
        "- `5`: Fix the watering reminders (doing)\n"
        "- `6`: Rewrite the onboarding copy Notes: Shorter"
    )


def test_a_listing_says_how_many_were_left_out() -> None:
    bridge = FakeBridge({"todos.list": {"todos": [COPY], "omitted": 40}})
    result = asyncio.run(todo_tools(bridge)["list_todos"]())
    assert result.startswith(
        "41 open to-dos, too many to send at once: the newest 1, the oldest 40 left out:"
    )


def test_an_empty_listing_says_so() -> None:
    tools = todo_tools(FakeBridge({"todos.list": {"todos": []}}))
    assert asyncio.run(tools["list_todos"]("done")) == "There are no done to-dos."
    assert asyncio.run(tools["list_todos"]("all")) == "The list is empty."


def test_adding_sends_each_title_and_reads_back_what_was_added() -> None:
    bridge = FakeBridge({"todos.add": [COPY]})
    result = asyncio.run(todo_tools(bridge)["add_todos"]([" Rewrite the copy ", " "]))

    assert bridge.calls == [("todos.add", {"items": [{"title": "Rewrite the copy"}]})]
    assert result.startswith("Added:")


def test_adding_nothing_or_too_much_asks_again_without_calling_the_app() -> None:
    bridge = FakeBridge({})
    tools = todo_tools(bridge)
    with pytest.raises(ToolError):
        _ = asyncio.run(tools["add_todos"]([" "]))
    with pytest.raises(ToolError):
        _ = asyncio.run(tools["add_todos"]([f"to-do {i}" for i in range(21)]))
    assert bridge.calls == []


def test_an_update_sends_only_what_changes() -> None:
    bridge = FakeBridge({"todos.update": {**COPY, "status": "done"}})
    result = asyncio.run(todo_tools(bridge)["update_todo"](6, status="done"))

    assert bridge.calls == [("todos.update", {"number": 6, "status": "done"})]
    assert result == "Now `6`: Rewrite the onboarding copy (done) Notes: Shorter"
    with pytest.raises(ToolError):
        _ = asyncio.run(todo_tools(bridge)["update_todo"](6))


def test_what_the_app_refuses_reaches_the_model_as_is() -> None:
    refused = ExtensionError("There's no to-do number 9.")
    bridge = FakeBridge({"todos.remove": refused})
    with pytest.raises(ToolError, match="There's no to-do number 9."):
        _ = asyncio.run(todo_tools(bridge)["remove_todo"](9))


def test_an_answer_of_another_shape_fails_the_tool() -> None:
    bridge = FakeBridge({"todos.list": {"oops": True}})
    with pytest.raises(ToolError):
        _ = asyncio.run(todo_tools(bridge)["list_todos"]())


def test_plain_results_have_no_markdown() -> None:
    bridge = FakeBridge({"todos.list": {"todos": [REMINDERS]}})
    context = ExtensionContext(bridge=bridge, style=PLAIN)
    result = asyncio.run(todo_tools(bridge, context)["list_todos"]())
    assert result == "1 open to-do:\n\n5: Fix the watering reminders (doing)"


def test_the_note_lists_the_open_todos_the_app_sent() -> None:
    data: dict[str, JsonValue] = {"open": [REMINDERS, COPY], "more": 3}
    note = TODOS_EXTENSION.note(ExtensionContext(bridge=FakeBridge({}), data=data))

    assert note.startswith("## To-dos")
    assert "`start_task`" in note
    assert "newest first and 3 more:" in note
    assert "- `6`: Rewrite the onboarding copy" in note


def test_without_open_todos_the_note_says_the_list_is_clear() -> None:
    context = ExtensionContext(bridge=FakeBridge({}), style=PLAIN, data={})
    note = TODOS_EXTENSION.note(context)
    assert "Nothing was open" in note
    assert "##" not in note and "`" not in note


def test_a_call_has_the_extensions_the_app_sent_that_bomby_has() -> None:
    fields = JobMetadata.model_validate(
        {"extensions": {"todos": {"open": []}, "from-a-newer-app": {}}}
    )
    call = CallExtensions.for_call(fields.extensions, FakeBridge({}), PLAIN)

    assert call.ids == ["todos"]
    assert len(call.tools()) == 1
    assert CallExtensions.for_call({}, FakeBridge({}), PLAIN).tools() == []


def test_the_catalogue_lists_every_extension() -> None:
    catalogue = cast(dict[str, list[dict[str, object]]], json.loads(render()))
    assert [e["id"] for e in catalogue["extensions"]] == list(EXTENSIONS)
    assert catalogue["extensions"][0]["name"] == "To-dos"


@final
class FakeParticipant:
    def __init__(self, answer: str | rtc.RpcError) -> None:
        self.answer = answer
        self.sent: list[tuple[str, str, str]] = []

    async def perform_rpc(
        self, *, destination_identity: str, method: str, payload: str
    ) -> str:
        self.sent.append((destination_identity, method, payload))
        if isinstance(self.answer, rtc.RpcError):
            raise self.answer
        return self.answer


def bridge_answering(answer: str | rtc.RpcError) -> tuple[RoomBridge, FakeParticipant]:
    participant = FakeParticipant(answer)
    room = cast(
        rtc.Room, cast(object, type("Room", (), {"local_participant": participant}))
    )
    return RoomBridge(room), participant


def test_the_bridge_asks_the_apps_page_by_method_with_json() -> None:
    bridge, participant = bridge_answering('[{"number": 1}]')
    answer = asyncio.run(bridge.call("todos.list", {"status": "open"}))

    assert answer == [{"number": 1}]
    assert participant.sent == [("user", "bomby.todos.list", '{"status": "open"}')]


def test_a_refusal_carries_the_apps_words_and_other_failures_one_line() -> None:
    refused, _ = bridge_answering(
        rtc.RpcError(REFUSED, "Keep it under 200 characters.")
    )
    with pytest.raises(ExtensionError, match="Keep it under 200 characters."):
        _ = asyncio.run(refused.call("todos.add", {}))

    gone, _ = bridge_answering(rtc.RpcError(1401, "Recipient not found"))
    with pytest.raises(ExtensionError, match=UNREACHABLE):
        _ = asyncio.run(gone.call("todos.add", {}))

    timed_out, _ = bridge_answering(rtc.RpcError(1502, "Response timeout"))
    with pytest.raises(ExtensionError, match=UNCONFIRMED):
        _ = asyncio.run(timed_out.call("todos.add", {}))

    garbled, _ = bridge_answering("not json")
    with pytest.raises(ExtensionError, match=UNCONFIRMED):
        _ = asyncio.run(garbled.call("todos.add", {}))
