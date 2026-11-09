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
from tools.start_task import (
    SHORTENED,
    TOO_LONG,
    estimate_tokens,
    fit_report,
    start_task,
)
from voice_providers import GEMINI, OPENAI, RIME, VoiceProvider


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


def test_with_the_projects_agents_off_the_note_says_where_to_turn_them_on() -> None:
    note = agents_note([], agents_off=True)

    assert "turned agents off for this project" in note
    assert "project's settings" in note
    assert "install" not in note


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

    def __init__(
        self, runner: FakeRunner, board: TaskBoard, provider: VoiceProvider = GEMINI
    ) -> None:
        self.userdata = SimpleNamespace(
            runners=FakeRunners(runner), board=board, provider=provider
        )
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


def repeat(provider: VoiceProvider) -> tuple[str, str, int]:
    """The same request twice, the second while the first still runs."""

    async def scenario() -> tuple[str, str, int]:
        runner = FakeRunner(Turn("Fixed."), steers=True)
        b, _ = board()
        context = cast(RunContext[Call], cast(object, FakeContext(runner, b, provider)))
        first = asyncio.create_task(
            start_task(context, "fix the header", "page", "claude")
        )
        await asyncio.sleep(0.01)
        runner.busy = True
        second = asyncio.create_task(
            start_task(context, "fix the header", "page", "claude")
        )
        await asyncio.sleep(0.01)
        runner.release.set()
        return await first, await second, len(b.tasks)

    return asyncio.run(scenario())


def test_on_rime_the_same_request_again_at_once_is_not_sent_twice() -> None:
    # Prism can call start_task twice for one request, a second or so apart.
    result, again, tasks = repeat(RIME)
    assert result == "Fixed."
    assert again.startswith("Already asked: Claude is on this in session page.")
    assert tasks == 1, "the repeat starts nothing"


def test_on_gemini_a_repeat_goes_through_as_before() -> None:
    # Gemini never gets the check: the second request joins the running task.
    _, again, tasks = repeat(GEMINI)
    assert not again.startswith("Already asked")
    assert tasks == 2


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


LONG_REPORT = "The wiki covers the team's clients. " + " ".join(
    f"Point {n} is about one more page of the wiki." for n in range(200)
)


def finished_report(provider: VoiceProvider, report: str) -> str:
    async def scenario() -> str:
        runner = FakeRunner(Turn(report))
        runner.release.set()
        b, _ = board()
        context = cast(RunContext[Call], cast(object, FakeContext(runner, b, provider)))
        return await start_task(context, "Summarise the wiki", "wiki", "claude")

    return asyncio.run(scenario())


def test_on_gpt_live_a_long_report_is_cut_to_what_it_can_take() -> None:
    result = finished_report(OPENAI, LONG_REPORT)
    limit = OPENAI.late_result_tokens
    assert limit is not None
    assert estimate_tokens(result) <= limit
    assert result.startswith("The wiki covers the team's clients.")
    assert result.endswith(SHORTENED)
    assert result.removesuffix(SHORTENED).endswith("."), "cut at a sentence's end"


def test_on_gemini_and_prism_a_long_report_arrives_whole() -> None:
    assert finished_report(GEMINI, LONG_REPORT) == LONG_REPORT
    assert finished_report(RIME, LONG_REPORT) == LONG_REPORT


def test_on_gpt_live_a_short_report_is_untouched() -> None:
    assert finished_report(OPENAI, "Fixed the header.") == "Fixed the header."


def test_a_report_without_sentences_is_cut_at_a_word() -> None:
    cut = fit_report("word " * 300, 100)
    assert estimate_tokens(cut) <= 100
    assert cut.removesuffix(SHORTENED).endswith("word")


def test_a_japanese_report_is_counted_by_its_characters_not_its_length() -> None:
    # About a token a character: 600 characters is far over budget though under 1,600.
    report = "ウィキはチームの顧客について書かれています。" * 30
    cut = fit_report(report, 300)
    assert estimate_tokens(cut) <= 300
    assert cut.removesuffix(SHORTENED).endswith("。")


def test_a_task_that_leaves_no_room_sends_a_short_note_instead() -> None:
    assert fit_report(LONG_REPORT, 20) == TOO_LONG
    assert fit_report(LONG_REPORT, -500) == TOO_LONG
