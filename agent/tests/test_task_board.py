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
        id = await b.start(CLAUDE_CODE, "landing-page", "fix the header")
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
            _ = await b.start(GOOSE, f"s{n}", "x" * (TASK_CHARS + 50))

    asyncio.run(scenario())

    latest = sent[-1]
    assert len(latest) == KEEP and latest[0]["session"] == "s5"
    assert len(str(latest[0]["task"])) == TASK_CHARS


def test_a_failed_publish_never_stops_the_work() -> None:
    async def publish(attributes: dict[str, str]) -> None:
        raise RuntimeError(f"not connected, {len(attributes)} attribute lost")

    b = TaskBoard(publish)

    async def scenario() -> str:
        id = await b.start(CLAUDE_CODE, "main", "hello")
        await b.finish(id, "failed")
        return id

    assert asyncio.run(scenario()) == "1"
    assert b.tasks[0].status == "failed"
