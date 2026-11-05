import asyncio
import dataclasses
import json
import os
import sys
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from typing import Any

import pytest
from acp.schema import PermissionOption
from livekit.agents.llm import ToolError

from acp_client import AcpRunner
from acp_client.client import pick_allow
from acp_client.runner import (
    Turn,
    briefing,
    child_environment,
    steered_note,
    stopped,
)
from harnesses import CLAUDE_CODE, Harness
from project import Project

FAKE_AGENT = Path(__file__).resolve().parent / "fake_claude_acp.py"


def run_with_fake(
    tmp_path: Path,
    scenario: Callable[[AcpRunner], Awaitable[Any]],
    *,
    folders: tuple[Path, ...] | None = None,
    env: Mapping[str, str] | None = None,
    harness: Harness = CLAUDE_CODE,
) -> tuple[Any, list[dict[str, Any]]]:
    """Run `scenario` against the fake ACP agent; return its result and the agent's log."""
    log = tmp_path / "acp.jsonl"
    runner = AcpRunner(
        harness=harness,
        command=sys.executable,
        args=[str(FAKE_AGENT)],
        project=Project(name="test", folders=folders or (tmp_path,)),
        env={**os.environ, **(env or {}), "FAKE_ACP_LOG": str(log)},
    )

    async def main() -> Any:
        try:
            return await scenario(runner)
        finally:
            await runner.aclose()

    result = asyncio.run(main())
    events = [json.loads(line) for line in log.read_text().splitlines()]
    return result, events


async def text(turn: Awaitable[Turn]) -> str:
    """The text a request came back with."""
    return (await turn).text


def names(events: list[dict[str, Any]]) -> list[str]:
    return [e["event"] for e in events]


async def until_prompted(
    runner: AcpRunner, task: str, session: str = "main"
) -> asyncio.Task[str]:
    """Start `task` in `session` and return once its turn is running."""
    running = asyncio.create_task(text(runner.run(task, session)))
    for _ in range(200):
        if runner.is_busy(session):
            await asyncio.sleep(0.2)  # let the prompt reach the agent
            return running
        await asyncio.sleep(0.05)
    raise AssertionError("the turn never started")


def test_run_returns_only_the_final_message(tmp_path: Path) -> None:
    result, events = run_with_fake(
        tmp_path, lambda r: text(r.run("reply all tests pass"))
    )

    assert result == "Done: all tests pass"
    assert names(events) == [
        "initialize",
        "new_session",
        "set_session_mode",
        "prompt",
        "close_session",
    ]


def test_new_session_appends_system_prompt_and_bypasses_permissions(
    tmp_path: Path,
) -> None:
    _, events = run_with_fake(tmp_path, lambda r: text(r.run("reply ok")))

    new_session = next(e for e in events if e["event"] == "new_session")
    assert new_session["system_prompt"] == {
        "append": briefing(Project(name="test", folders=(tmp_path,)))
    }
    prompt = next(e for e in events if e["event"] == "prompt")
    assert prompt["blocks"] == ["reply ok"]  # already in the system prompt
    mode = next(e for e in events if e["event"] == "set_session_mode")
    assert mode["mode_id"] == "bypassPermissions"


def test_project_folders_become_cwd_and_extra_directories(tmp_path: Path) -> None:
    main, other = tmp_path / "main", tmp_path / "other"
    main.mkdir()
    other.mkdir()

    _, events = run_with_fake(
        tmp_path, lambda r: text(r.run("reply ok")), folders=(main, other)
    )

    new_session = next(e for e in events if e["event"] == "new_session")
    assert new_session["cwd"] == str(main)
    assert new_session["additional_directories"] == [str(other)]


def test_without_a_system_prompt_the_briefing_goes_with_the_first_task(
    tmp_path: Path,
) -> None:
    main, other = tmp_path / "main", tmp_path / "other"
    main.mkdir()
    other.mkdir()
    plain = dataclasses.replace(CLAUDE_CODE, id="plain", system_prompt_append=False)

    async def scenario(runner: AcpRunner) -> list[str]:
        return [(await runner.run("turns")).text, (await runner.run("turns")).text]

    _, events = run_with_fake(tmp_path, scenario, folders=(main, other), harness=plain)

    first, second = [e["blocks"] for e in events if e["event"] == "prompt"]
    assert first[1:] == ["turns"] and second == ["turns"]
    assert f"You're working in {main}" in first[0]
    assert f"also includes {other}" in first[0]
    new_session = next(e for e in events if e["event"] == "new_session")
    assert new_session["system_prompt"] is None


def test_the_briefing_ends_with_the_project_and_its_description(tmp_path: Path) -> None:
    project = Project(name="samba", folders=(tmp_path,), instructions="A music app.")

    expected = (
        f"## This project\n\nsamba. You're working in {tmp_path}.\n\n"
        "The user's description of this project:\n\nA music app."
    )
    assert briefing(project).endswith(expected)


def test_the_briefing_says_nothing_of_a_description_the_user_never_wrote(
    tmp_path: Path,
) -> None:
    text = briefing(Project(name="samba", folders=(tmp_path,)))

    assert text.endswith(f"## This project\n\nsamba. You're working in {tmp_path}.")
    assert "description" not in text


def test_follow_ups_continue_the_same_session(tmp_path: Path) -> None:
    async def scenario(runner: AcpRunner) -> list[str]:
        return [(await runner.run("turns")).text, (await runner.run("turns")).text]

    result, events = run_with_fake(tmp_path, scenario)

    assert result == ["turn 1", "turn 2"]
    assert names(events).count("new_session") == 1
    assert names(events).count("close_session") == 1
    assert names(events)[-1] == "close_session"  # only when the call ends


def test_sessions_run_in_parallel_and_each_keeps_its_context(
    tmp_path: Path,
) -> None:
    async def scenario(runner: AcpRunner) -> list[str]:
        page = await until_prompted(runner, "hang", "page")
        # "page" is still working; "api" opens its own session and runs alongside it.
        api = [
            (await runner.run("turns", "api")).text,
            (await runner.run("turns", "api")).text,
        ]
        _ = page.cancel()
        with pytest.raises(asyncio.CancelledError):
            await page
        return [*api, (await runner.run("turns", "page")).text]

    result, events = run_with_fake(tmp_path, scenario)

    assert result == ["turn 1", "turn 2", "turn 2"]
    assert names(events).count("initialize") == 1
    assert names(events).count("new_session") == 2
    opened = {e["session_id"] for e in events if e["event"] == "new_session"}
    closed = {e["session_id"] for e in events if e["event"] == "close_session"}
    assert closed == opened


def test_session_names_ignore_case_and_spacing(tmp_path: Path) -> None:
    async def scenario(runner: AcpRunner) -> list[str]:
        return [
            (await runner.run("turns", "Landing page")).text,
            (await runner.run("turns", "landing-page")).text,
        ]

    result, events = run_with_fake(tmp_path, scenario)

    assert result == ["turn 1", "turn 2"]
    assert names(events).count("new_session") == 1


def test_a_request_mid_turn_is_steered_into_it(tmp_path: Path) -> None:
    async def scenario(runner: AcpRunner) -> tuple[str, Turn]:
        first = await until_prompted(runner, "wait landing page", "page")
        steered = await runner.run("make the header blue", "page")
        # A steered request answers only once the turn it joined has ended.
        assert first.done()
        return await first, steered

    (first, steered), events = run_with_fake(tmp_path, scenario)

    assert first == "Done: landing page + make the header blue"
    assert steered == Turn(steered_note(CLAUDE_CODE), steered=True)
    steer = next(e for e in events if e["event"] == "steer")
    assert steer["idle_behavior"] == "promptRequired"
    assert steer["injected"] is True
    assert names(events).count("prompt") == 1


def test_a_steered_request_fails_when_the_turn_it_joined_is_stopped(
    tmp_path: Path,
) -> None:
    async def scenario(runner: AcpRunner) -> str:
        first = await until_prompted(runner, "hang", "page")
        steered = asyncio.create_task(runner.run("make the header blue", "page"))
        await asyncio.sleep(0.2)  # let the steer reach the agent
        _ = first.cancel()
        with pytest.raises(ToolError) as stopped_error:
            _ = await steered
        return str(stopped_error.value)

    message, _ = run_with_fake(tmp_path, scenario)

    assert message == stopped(CLAUDE_CODE)


PLAIN = dataclasses.replace(
    CLAUDE_CODE, id="plain", steer_method=None, bypass_mode=None
)


@pytest.mark.parametrize(
    ("harness", "env"),
    [
        # The adapter doesn't advertise steering.
        (CLAUDE_CODE, {"FAKE_ACP_NO_STEERING": "1"}),
        # The harness has no steer method (and no bypass mode).
        (PLAIN, {}),
    ],
    ids=["adapter", "harness"],
)
def test_without_steering_a_request_waits_for_the_running_turn(
    tmp_path: Path, harness: Harness, env: dict[str, str]
) -> None:
    async def scenario(runner: AcpRunner) -> list[str]:
        first = await until_prompted(runner, "hang")
        second = asyncio.create_task(text(runner.run("turns")))
        await asyncio.sleep(0.5)
        assert not second.done()  # queued behind the running turn
        _ = first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        return [await second]

    result, events = run_with_fake(tmp_path, scenario, env=env, harness=harness)

    assert result == ["turn 2"]
    assert "steer" not in names(events)
    if harness is PLAIN:
        assert "set_session_mode" not in names(events)


def test_cancelling_stops_the_turn_and_keeps_the_session(tmp_path: Path) -> None:
    async def scenario(runner: AcpRunner) -> str:
        task = await until_prompted(runner, "hang")
        _ = task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        return (await runner.run("turns")).text

    result, events = run_with_fake(tmp_path, scenario)

    assert result == "turn 2"
    assert names(events).count("new_session") == 1
    assert names(events).index("cancel") < names(events).index("close_session")


def test_aclose_closes_a_session_still_running(tmp_path: Path) -> None:
    async def scenario(runner: AcpRunner) -> None:
        task = await until_prompted(runner, "hang")
        await runner.aclose()
        _ = task.cancel()
        with pytest.raises((asyncio.CancelledError, ToolError)):
            await task

    _, events = run_with_fake(tmp_path, scenario)

    assert "close_session" in names(events)


def test_no_new_work_after_the_call_ends(tmp_path: Path) -> None:
    async def scenario(runner: AcpRunner) -> None:
        _ = await runner.run("turns")
        await runner.aclose()
        with pytest.raises(ToolError, match="call is ending"):
            _ = await runner.run("turns")

    _, events = run_with_fake(tmp_path, scenario)

    assert names(events).count("initialize") == 1  # never respawned


def test_permission_requests_are_approved_once(tmp_path: Path) -> None:
    result, _ = run_with_fake(tmp_path, lambda r: text(r.run("permission")))

    assert result == "chose once"


def test_a_missing_adapter_is_reported_to_the_model(tmp_path: Path) -> None:
    runner = AcpRunner(
        harness=CLAUDE_CODE,
        command=str(tmp_path / "missing"),
        project=Project(name="test", folders=(tmp_path,)),
        env=os.environ,
    )

    with pytest.raises(ToolError, match="Claude isn't ready right now"):
        _ = asyncio.run(runner.run("reply ok"))


async def tool_error(runner: AcpRunner, task: str = "reply ok") -> str:
    with pytest.raises(ToolError) as caught:
        _ = await runner.run(task)
    return str(caught.value)


@pytest.mark.parametrize(
    "env",
    [
        {"FAKE_ACP_REFUSE_SESSION": "Configuration value not found: GOOSE_PROVIDER"},
        {"FAKE_ACP_AUTH_REQUIRED": "1"},
    ],
)
def test_an_agent_that_isnt_set_up_is_reported_briefly(
    tmp_path: Path, env: dict[str, str]
) -> None:
    message, _ = run_with_fake(tmp_path, tool_error, env=env)

    assert message == (
        "Claude isn't ready right now. Say sorry and offer another agent, if there "
        "is one."
    )


def test_a_failed_turn_and_a_crash_are_reported_briefly_and_the_next_task_restarts(
    tmp_path: Path,
) -> None:
    async def scenario(runner: AcpRunner) -> tuple[str, str, str]:
        failed = await tool_error(runner, "fail Rate limited")
        crashed = await tool_error(runner, "crash out of memory")
        return failed, crashed, (await runner.run("reply back")).text

    (failed, crashed, after), _ = run_with_fake(tmp_path, scenario)

    stopped = (
        "Claude stopped before finishing. Say sorry and offer to try again or to try "
        "another agent."
    )
    assert failed == crashed == stopped
    assert after == "Done: back"


def test_child_environment_drops_dotenv_secrets_and_api_keys() -> None:
    environ = {
        "PATH": "/bin",
        "SSH_AUTH_SOCK": "/tmp/agent",
        "GOOGLE_API_KEY": "g",
        "ANTHROPIC_API_KEY": "a",
        "CLAUDECODE": "1",
    }

    assert child_environment(environ, {"GOOGLE_API_KEY"}, CLAUDE_CODE) == {
        "PATH": "/bin",
        "SSH_AUTH_SOCK": "/tmp/agent",
    }


def test_child_environment_drops_the_keys_the_app_passes() -> None:
    environ = {
        "PATH": "/bin",
        "LIVEKIT_URL": "wss://x",
        "LIVEKIT_API_KEY": "k",
        "LIVEKIT_API_SECRET": "s",
        "GOOGLE_API_KEY": "g",
        "CLAUDE_CODE_EXECUTABLE": "/usr/local/bin/claude",
    }

    assert child_environment(environ, set(), CLAUDE_CODE) == {
        "PATH": "/bin",
        "CLAUDE_CODE_EXECUTABLE": "/usr/local/bin/claude",
    }


def test_pick_allow_prefers_allow_once() -> None:
    options = [
        PermissionOption(option_id="a", name="Always", kind="allow_always"),
        PermissionOption(option_id="o", name="Once", kind="allow_once"),
    ]
    assert (chosen := pick_allow(options)) is not None and chosen.option_id == "o"
    assert (
        pick_allow([PermissionOption(option_id="n", name="No", kind="reject_once")])
        is None
    )
