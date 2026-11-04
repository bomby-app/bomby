import asyncio
import contextlib
import json
from types import SimpleNamespace
from typing import cast, final, get_args

from livekit.agents import RunContext

from acp_client.runner import Turn
from call import Call
from harnesses import CLAUDE_CODE, HARNESSES, OMP, OPENCODE, AgentName, Harness
from task_board import ATTRIBUTE, TaskBoard
from tools import agents_note
from tools.start_task import start_task


def test_start_task_offers_exactly_the_known_harnesses() -> None:
    assert set(get_args(AgentName)) == set(HARNESSES)


def test_the_agents_note_lists_what_is_installed_with_claude_first() -> None:
    note = agents_note([CLAUDE_CODE, OPENCODE, OMP])

    assert "`claude` (Claude), `opencode` (OpenCode) and `omp` (omp)" in note
    assert "Use `claude` unless" in note


def test_without_claude_the_first_installed_agent_is_the_default() -> None:
    assert "Use `opencode` unless" in agents_note([OPENCODE])


def test_with_no_agents_the_note_says_work_cant_start() -> None:
    assert "can't start" in agents_note([])


@final
class FakeRunner:
    """Stands in for an `AcpRunner`: `run` waits on `release`, then returns `turn`."""

    def __init__(self, turn: Turn) -> None:
        self.turn = turn
        self.release = asyncio.Event()

    def is_busy(self, _name: str) -> bool:
        return False

    async def run(self, _task: str, _session: str) -> Turn:
        _ = await self.release.wait()
        return self.turn


@final
class FakeRunners:
    def __init__(self, runner: FakeRunner) -> None:
        self.runner = runner

    def get(self, _harness: Harness) -> FakeRunner:
        return self.runner


@final
class FakeContext:
    """The part of `RunContext[Call]` that `start_task` uses."""

    def __init__(self, runner: FakeRunner, board: TaskBoard) -> None:
        self.userdata = SimpleNamespace(runners=FakeRunners(runner), board=board)

    async def update(self, _message: str) -> None:
        pass


def board() -> tuple[TaskBoard, list[str]]:
    """A board, and each status its only task was published with."""
    sent: list[str] = []

    async def publish(attributes: dict[str, str]) -> None:
        tasks = cast(list[dict[str, str]], json.loads(attributes[ATTRIBUTE]))
        sent.append(tasks[0]["status"])

    return TaskBoard(publish), sent


async def call_start_task(runner: FakeRunner, board: TaskBoard) -> str:
    context = cast(RunContext[Call], cast(object, FakeContext(runner, board)))
    return await start_task(context, "fix the header", "page", "claude")


def test_a_finished_task_is_done_and_a_steered_one_added() -> None:
    async def scenario(turn: Turn) -> tuple[str, list[str]]:
        runner = FakeRunner(turn)
        runner.release.set()
        b, sent = board()
        return await call_start_task(runner, b), sent

    assert asyncio.run(scenario(Turn("Fixed."))) == ("Fixed.", ["working", "done"])
    steered = Turn("Folded in.", steered=True)
    assert asyncio.run(scenario(steered)) == ("Folded in.", ["working", "added"])


def test_a_cancelled_task_ends_stopped() -> None:
    async def scenario() -> list[str]:
        b, sent = board()
        task = asyncio.create_task(call_start_task(FakeRunner(Turn("never")), b))
        await asyncio.sleep(0.05)
        _ = task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        return sent

    assert asyncio.run(scenario()) == ["working", "stopped"]
