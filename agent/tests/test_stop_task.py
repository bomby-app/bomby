"""The user stops a task from the agents panel (`TaskBoard.stop`), against the fake ACP
agent: `start_task` returns who stopped it, as a result, and the board shows `stopped`."""

import asyncio
import json
import os
import sys
from collections.abc import Awaitable, Callable
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast, final

from livekit.agents import RunContext

from acp_client.runner import AcpRunner
from call import Call
from harnesses import CLAUDE_CODE, Harness
from project import Project
from task_board import ATTRIBUTE, Task, TaskBoard
from tests.test_runner import FAKE_AGENT, logged, until_logged
from tools.start_task import start_task, user_stopped
from voice_providers import GEMINI


def test_the_line_says_who_stopped_the_task() -> None:
    assert user_stopped("John") == "John stopped the task."
    assert user_stopped("") == "The user stopped the task."


@final
class Runners:
    def __init__(self, runner: AcpRunner) -> None:
        self.runner = runner

    def get(self, _harness: Harness) -> AcpRunner:
        return self.runner


Scenario = Callable[
    [AcpRunner, TaskBoard, Callable[[str], "asyncio.Task[str]"]], Awaitable[Any]
]


def with_fake(
    tmp_path: Path,
    scenario: Scenario,
    user_name: str = "",
    steering: bool = True,
    slow_cancel: float = 0,
) -> tuple[Any, list[list[dict[str, Any]]]]:
    """Runs `scenario` with `start_task` on the fake agent: it gets the runner, the board,
    and a way to send a request to session "page". Returns its result and every list the
    board published."""
    env = {**os.environ, "FAKE_ACP_LOG": str(tmp_path / "acp.jsonl")}
    if not steering:
        env["FAKE_ACP_NO_STEERING"] = "1"
    if slow_cancel:
        # The agent takes this long to stop after a cancel, as one stopping its tools does.
        env["FAKE_ACP_SLOW_CANCEL"] = str(slow_cancel)
    runner = AcpRunner(
        harness=CLAUDE_CODE,
        command=sys.executable,
        args=[str(FAKE_AGENT)],
        project=Project(name="test", folders=(tmp_path,)),
        env=env,
    )
    sent: list[list[dict[str, Any]]] = []

    async def update(_message: str) -> None:
        pass

    async def publish(attributes: dict[str, str]) -> None:
        sent.append(json.loads(attributes[ATTRIBUTE]))

    board = TaskBoard(publish)
    context = cast(
        RunContext[Call],
        cast(
            object,
            SimpleNamespace(
                userdata=SimpleNamespace(
                    runners=Runners(runner),
                    board=board,
                    provider=GEMINI,
                    user_name=user_name,
                ),
                update=update,
            ),
        ),
    )

    def send(task: str) -> asyncio.Task[str]:
        return asyncio.create_task(start_task(context, task, "page", "claude"))

    async def main() -> Any:
        try:
            return await scenario(runner, board, send)
        finally:
            await runner.aclose()

    return asyncio.run(main()), sent


async def until_status(board: TaskBoard, id: str, status: str) -> Task:
    for _ in range(400):
        task = next((t for t in board.tasks if t.id == id), None)
        if task is not None and task.status == status:
            return task
        await asyncio.sleep(0.05)
    raise AssertionError(f"task {id} never got to {status}")


def test_stopping_a_working_task_stops_its_turn_and_keeps_the_session(
    tmp_path: Path,
) -> None:
    async def scenario(
        runner: AcpRunner,
        board: TaskBoard,
        send: Callable[[str], asyncio.Task[str]],
    ) -> tuple[str, str, str]:
        first = send("hang")
        await until_logged(runner, "prompt", text="hang")
        outcome = board.stop("1")
        result = await first
        await until_logged(runner, "cancel")
        # The same session takes the next request.
        return outcome, result, await send("turns")

    (outcome, result, after), _ = with_fake(tmp_path, scenario, user_name="John")

    assert outcome == "stopped"
    assert result == "John stopped the task."
    assert after == "turn 2"


def test_stopping_a_steered_request_stops_the_whole_turn(tmp_path: Path) -> None:
    async def scenario(
        runner: AcpRunner,
        board: TaskBoard,
        send: Callable[[str], asyncio.Task[str]],
    ) -> tuple[str, str, str, list[str]]:
        first = send("hang")
        await until_logged(runner, "prompt", text="hang")
        steered = send("make it blue")
        await until_logged(runner, "steer", text="make it blue")
        _ = await until_status(board, "2", "working")
        # Stopping the request that joined stops the turn it rides on.
        outcome = board.stop("2")
        results = await asyncio.gather(first, steered)
        return outcome, *results, [t.status for t in board.tasks]

    (outcome, first, steered, statuses), _ = with_fake(tmp_path, scenario)

    assert outcome == "stopped"
    assert first == steered == "The user stopped the task."
    assert statuses == ["stopped", "stopped"]


def turn_events(tmp_path: Path) -> list[str]:
    """The fake agent's prompts, cancels and turns it stopped, in order."""
    lines = (tmp_path / "acp.jsonl").read_text().splitlines()
    events = [json.loads(line)["event"] for line in lines]
    return [e for e in events if e in ("prompt", "cancel", "stopped")]


def test_a_request_that_joined_hears_stopped_only_once_the_agent_has(
    tmp_path: Path,
) -> None:
    async def scenario(
        runner: AcpRunner,
        board: TaskBoard,
        send: Callable[[str], asyncio.Task[str]],
    ) -> tuple[str, int, list[str]]:
        first = send("hang")
        await until_logged(runner, "prompt", text="hang")
        steered = send("make it blue")
        await until_logged(runner, "steer", text="make it blue")
        _ = await until_status(board, "2", "working")
        _ = board.stop("1")
        result = await steered
        # By the time it says so, the agent has confirmed its turn is over.
        confirmed = logged(runner, "stopped")
        statuses = [t.status for t in board.tasks]
        _ = await first
        return result, confirmed, statuses

    (result, confirmed, statuses), _ = with_fake(tmp_path, scenario, slow_cancel=0.4)

    assert result == "The user stopped the task."
    assert confirmed == 1
    assert statuses[1] == "stopped"


def test_stopping_again_while_the_agent_stops_keeps_its_session_held(
    tmp_path: Path,
) -> None:
    async def scenario(
        runner: AcpRunner,
        board: TaskBoard,
        send: Callable[[str], asyncio.Task[str]],
    ) -> tuple[str, str, str]:
        first = send("hang")
        await until_logged(runner, "prompt", text="hang")
        steered = send("make it blue")
        await until_logged(runner, "steer", text="make it blue")
        _ = await until_status(board, "2", "working")
        assert board.stop("1") == "stopped"
        await until_logged(runner, "cancel")
        # The turn's other row, while the agent is still stopping: nothing new to do.
        again = board.stop("2")
        after = await send("turns")
        _ = await asyncio.gather(first, steered)
        return again, after, await first

    (again, after, first), _ = with_fake(tmp_path, scenario, slow_cancel=0.5)

    assert again == "stopped"
    assert first == "The user stopped the task."
    assert after == "turn 2"
    # The next request started only once the old turn was over, in the same agent.
    assert turn_events(tmp_path) == ["prompt", "cancel", "stopped", "prompt"]


def test_a_queued_task_is_dropped_before_it_starts(tmp_path: Path) -> None:
    async def scenario(
        runner: AcpRunner,
        board: TaskBoard,
        send: Callable[[str], asyncio.Task[str]],
    ) -> tuple[str, str, list[str], int]:
        first = send("hang")
        await until_logged(runner, "prompt", text="hang")
        queued = send("reply never sent")
        _ = await until_status(board, "2", "queued")
        outcome = board.stop("2")
        result = await queued
        statuses = [t.status for t in board.tasks]
        _ = board.stop("1")
        _ = await first
        return (
            outcome,
            result,
            statuses,
            logged(runner, "prompt", text="reply never sent"),
        )

    (outcome, result, statuses, prompted), _ = with_fake(
        tmp_path, scenario, steering=False
    )

    assert outcome == "stopped"
    assert result == "The user stopped the task."
    assert statuses == ["working", "stopped"], "the running task goes on"
    assert prompted == 0, "the agent never got it"


def test_a_finished_or_unknown_task_cant_be_stopped(tmp_path: Path) -> None:
    async def scenario(
        _runner: AcpRunner,
        board: TaskBoard,
        send: Callable[[str], asyncio.Task[str]],
    ) -> tuple[str, str, str, str]:
        result = await send("reply fixed")
        return result, board.stop("1"), board.stop("7"), board.tasks[0].status

    (result, finished, unknown, status), sent = with_fake(tmp_path, scenario)

    assert result == "Done: fixed"
    assert (finished, unknown) == ("over", "unknown")
    assert status == "done", "nothing changed"
    assert [t["status"] for t in sent[-1]] == ["done"]


def test_the_voice_models_own_cancel_still_raises(tmp_path: Path) -> None:
    async def scenario(
        runner: AcpRunner,
        board: TaskBoard,
        send: Callable[[str], asyncio.Task[str]],
    ) -> tuple[bool, str]:
        first = send("hang")
        await until_logged(runner, "prompt", text="hang")
        _ = first.cancel()
        try:
            _ = await first
        except asyncio.CancelledError:
            return True, board.tasks[0].status
        return False, board.tasks[0].status

    (raised, status), _ = with_fake(tmp_path, scenario)

    assert raised
    assert status == "stopped"
