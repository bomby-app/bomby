import asyncio
import json

from harnesses import CLAUDE_CODE, GOOSE
from task_board import ATTRIBUTE, KEEP, TASK_CHARS, TaskBoard


def board() -> tuple[TaskBoard, list[list[dict[str, object]]]]:
    sent: list[list[dict[str, object]]] = []

    async def publish(attributes: dict[str, str]) -> None:
        sent.append(json.loads(attributes[ATTRIBUTE]))

    return TaskBoard(publish), sent


def test_a_task_is_published_when_it_starts_and_when_it_ends() -> None:
    b, sent = board()

    async def scenario() -> None:
        id = b.add(CLAUDE_CODE, "landing-page", "fix the header")
        await b.publish()
        await b.finish(id, "done")

    asyncio.run(scenario())

    assert [t["status"] for t in sent[0]] == ["working"]
    (task,) = sent[1]
    assert task["agent"] == "claude" and task["agentName"] == "Claude"
    assert task["session"] == "landing-page" and task["task"] == "fix the header"
    assert task["status"] == "done" and task["endedAt"] is not None


def test_only_the_latest_tasks_are_kept_and_long_ones_are_shortened() -> None:
    b, sent = board()

    async def scenario() -> None:
        for n in range(KEEP + 5):
            _ = b.add(GOOSE, f"s{n}", "x" * (TASK_CHARS + 50))
            await b.publish()

    asyncio.run(scenario())

    latest = sent[-1]
    assert len(latest) == KEEP and latest[0]["session"] == "s5"
    assert len(str(latest[0]["task"])) == TASK_CHARS


def test_a_failed_publish_never_stops_the_work() -> None:
    async def publish(attributes: dict[str, str]) -> None:
        raise RuntimeError(f"not connected, {len(attributes)} attribute lost")

    b = TaskBoard(publish)

    async def scenario() -> str:
        id = b.add(CLAUDE_CODE, "main", "hello")
        await b.publish()
        await b.finish(id, "failed")
        return id

    assert asyncio.run(scenario()) == "1"
    assert b.tasks[0].status == "failed"


def test_a_repeat_is_the_same_request_word_for_word() -> None:
    b, _ = board()
    head = "x" * TASK_CHARS
    _ = b.add(CLAUDE_CODE, "page", head + " then make it blue")
    # Shortened alike on the board, but a different request.
    assert b.repeat_of(CLAUDE_CODE, "page", head + " then make it red") is None
    assert b.repeat_of(CLAUDE_CODE, "page", head + " then make it blue") is not None
    assert b.repeat_of(GOOSE, "page", head + " then make it blue") is None
    assert b.repeat_of(CLAUDE_CODE, "other", head + " then make it blue") is None


def test_a_finished_request_is_no_longer_a_repeat() -> None:
    b, _ = board()

    async def scenario() -> None:
        steered = b.add(CLAUDE_CODE, "page", "fix the header")
        # A steered request is marked added once the task it joined has ended.
        await b.finish(steered, "added")

    asyncio.run(scenario())
    assert b.repeat_of(CLAUDE_CODE, "page", "fix the header") is None
