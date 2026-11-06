import asyncio
import contextlib
import json
from collections.abc import Awaitable, Callable
from types import SimpleNamespace
from typing import cast, final, get_args

from livekit.agents import RunContext

from acp_client.runner import Turn
from call import Call
from harnesses import CLAUDE_CODE, HARNESSES, OMP, OPENCODE, AgentName, Harness
from sections import PLAIN
from task_board import ATTRIBUTE, TaskBoard
from tools import agents_note
from tools.start_task import start_task


def test_start_task_offers_exactly_the_known_harnesses() -> None:
    assert set(get_args(AgentName)) == set(HARNESSES)


def test_the_agents_note_lists_what_is_installed_with_claude_first() -> None:
    note = agents_note([CLAUDE_CODE, OPENCODE, OMP])

    assert "`claude` (Claude), `opencode` (OpenCode) and `omp` (omp)" in note
    assert "Use `claude` unless" in note


def test_a_plain_agents_note_has_no_markdown() -> None:
    note = agents_note([CLAUDE_CODE, OPENCODE], PLAIN)

    assert note == (
        "The agents you can use on this call: claude (Claude) and opencode (OpenCode). "
        "Use claude unless the user asks for another one by name."
    )


def test_without_claude_the_first_installed_agent_is_the_default() -> None:
    assert "Use `opencode` unless" in agents_note([OPENCODE])


def test_with_no_agents_the_note_says_work_cant_start_and_how_to_get_one() -> None:
    note = agents_note([])

    assert "can't start" in note
    assert "(Claude, Codex, OpenCode, omp, goose)" in note
    assert "Settings, Agents" in note


@final
class FakeRunner:
    """Stands in for an `AcpRunner`: `run` takes the task, waits on `release`, then
    returns `turn`. A `busy` one waits on `release` before taking the task too, like a
    session whose running task has to end first."""

    def __init__(self, turn: Turn, busy: bool = False, steers: bool = False) -> None:
        self.turn = turn
        self.busy = busy
        self.steers = steers
        self.release = asyncio.Event()

    def is_busy(self, _name: str) -> bool:
        return self.busy

    @property
    def can_steer(self) -> bool:
        return self.steers

    async def run(
        self,
        _task: str,
        _session: str,
        on_start: Callable[[], Awaitable[None]] | None = None,
    ) -> Turn:
        if self.busy:
            _ = await self.release.wait()
        if on_start is not None:
            await on_start()
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
        self.updates: list[str] = []

    async def update(self, message: str) -> None:
        self.updates.append(message)


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


def test_a_task_for_a_busy_session_is_queued_until_the_agent_takes_it() -> None:
    async def scenario() -> list[str]:
        runner = FakeRunner(Turn("Fixed."), busy=True)
        b, sent = board()
        task = asyncio.create_task(call_start_task(runner, b))
        await asyncio.sleep(0)
        runner.release.set()
        _ = await task
        return sent

    assert asyncio.run(scenario()) == ["queued", "working", "done"]


def test_gemini_hears_whether_a_request_joins_the_running_task_or_waits() -> None:
    async def first_update(steers: bool) -> str:
        runner = FakeRunner(Turn("Fixed."), busy=True, steers=steers)
        runner.release.set()
        context = FakeContext(runner, board()[0])
        _ = await start_task(
            cast(RunContext[Call], cast(object, context)), "go green", "page", "claude"
        )
        return context.updates[0]

    assert "joins the task that's running" in asyncio.run(first_update(steers=True))
    assert "runs next as a task of its own" in asyncio.run(first_update(steers=False))


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
