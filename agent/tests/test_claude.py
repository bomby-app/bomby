import asyncio
import json
import os
import sys
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from typing import Any

import pytest
from acp.schema import PermissionOption
from livekit.agents.llm import ToolError

from tools.claude import (
    STEERED,
    SYSTEM_PROMPT,
    ClaudeRunner,
    Project,
    child_environment,
    pick_allow,
)

FAKE_AGENT = Path(__file__).resolve().parent / "fake_claude_acp.py"


def run_with_fake(
    tmp_path: Path,
    scenario: Callable[[ClaudeRunner], Awaitable[Any]],
    *,
    folders: tuple[Path, ...] | None = None,
    env: Mapping[str, str] | None = None,
) -> tuple[Any, list[dict[str, Any]]]:
    """Run `scenario` against the fake ACP agent; return its result and the agent's log."""
    log = tmp_path / "acp.jsonl"
    runner = ClaudeRunner(
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


def names(events: list[dict[str, Any]]) -> list[str]:
    return [e["event"] for e in events]


async def until_prompted(
    runner: ClaudeRunner, task: str, session: str = "main"
) -> asyncio.Task[str]:
    """Start `task` in `session` and return once its turn is running."""
    running = asyncio.create_task(runner.run(task, session))
    for _ in range(200):
        if runner.is_busy(session):
            await asyncio.sleep(0.2)  # let the prompt reach the agent
            return running
        await asyncio.sleep(0.05)
    raise AssertionError("the turn never started")


def test_run_returns_only_the_final_message(tmp_path: Path) -> None:
    result, events = run_with_fake(tmp_path, lambda r: r.run("reply all tests pass"))

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
    _, events = run_with_fake(tmp_path, lambda r: r.run("reply ok"))

    new_session = next(e for e in events if e["event"] == "new_session")
    assert new_session["system_prompt"] == {"append": SYSTEM_PROMPT}
    mode = next(e for e in events if e["event"] == "set_session_mode")
    assert mode["mode_id"] == "bypassPermissions"


def test_project_folders_become_cwd_and_extra_directories(tmp_path: Path) -> None:
    main, other = tmp_path / "main", tmp_path / "other"
    main.mkdir()
    other.mkdir()

    _, events = run_with_fake(
        tmp_path, lambda r: r.run("reply ok"), folders=(main, other)
    )

    new_session = next(e for e in events if e["event"] == "new_session")
    assert new_session["cwd"] == str(main)
    assert new_session["additional_directories"] == [str(other)]


def test_follow_ups_continue_the_same_session(tmp_path: Path) -> None:
    async def scenario(runner: ClaudeRunner) -> list[str]:
        return [await runner.run("turns"), await runner.run("turns")]

    result, events = run_with_fake(tmp_path, scenario)

    assert result == ["turn 1", "turn 2"]
    assert names(events).count("new_session") == 1
    assert names(events).count("close_session") == 1
    assert names(events)[-1] == "close_session"  # only when the call ends


def test_sessions_run_in_parallel_and_each_keeps_its_context(
    tmp_path: Path,
) -> None:
    async def scenario(runner: ClaudeRunner) -> list[str]:
        page = await until_prompted(runner, "hang", "page")
        # "page" is still working; "api" opens its own session and runs alongside it.
        api = [await runner.run("turns", "api"), await runner.run("turns", "api")]
        _ = page.cancel()
        with pytest.raises(asyncio.CancelledError):
            await page
        return [*api, await runner.run("turns", "page")]

    result, events = run_with_fake(tmp_path, scenario)

    assert result == ["turn 1", "turn 2", "turn 2"]
    assert names(events).count("initialize") == 1
    assert names(events).count("new_session") == 2
    opened = {e["session_id"] for e in events if e["event"] == "new_session"}
    closed = {e["session_id"] for e in events if e["event"] == "close_session"}
    assert closed == opened


def test_session_names_ignore_case_and_spacing(tmp_path: Path) -> None:
    async def scenario(runner: ClaudeRunner) -> list[str]:
        return [
            await runner.run("turns", "Landing page"),
            await runner.run("turns", "landing-page"),
        ]

    result, events = run_with_fake(tmp_path, scenario)

    assert result == ["turn 1", "turn 2"]
    assert names(events).count("new_session") == 1


def test_a_request_mid_turn_is_steered_into_it(tmp_path: Path) -> None:
    async def scenario(runner: ClaudeRunner) -> tuple[str, str]:
        first = await until_prompted(runner, "wait landing page", "page")
        steered = await runner.run("make the header blue", "page")
        return await first, steered

    (first, steered), events = run_with_fake(tmp_path, scenario)

    assert first == "Done: landing page + make the header blue"
    assert steered == STEERED
    steer = next(e for e in events if e["event"] == "steer")
    assert steer["idle_behavior"] == "promptRequired"
    assert steer["injected"] is True
    assert names(events).count("prompt") == 1


def test_without_steering_a_request_waits_for_the_running_turn(
    tmp_path: Path,
) -> None:
    async def scenario(runner: ClaudeRunner) -> list[str]:
        first = await until_prompted(runner, "hang")
        second = asyncio.create_task(runner.run("turns"))
        await asyncio.sleep(0.5)
        assert not second.done()  # queued behind the running turn
        _ = first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        return [await second]

    result, events = run_with_fake(
        tmp_path, scenario, env={"FAKE_ACP_NO_STEERING": "1"}
    )

    assert result == ["turn 2"]
    assert "steer" not in names(events)


def test_cancelling_stops_the_turn_and_keeps_the_session(tmp_path: Path) -> None:
    async def scenario(runner: ClaudeRunner) -> str:
        task = await until_prompted(runner, "hang")
        _ = task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        return await runner.run("turns")

    result, events = run_with_fake(tmp_path, scenario)

    assert result == "turn 2"
    assert names(events).count("new_session") == 1
    assert names(events).index("cancel") < names(events).index("close_session")


def test_aclose_closes_a_session_still_running(tmp_path: Path) -> None:
    async def scenario(runner: ClaudeRunner) -> None:
        task = await until_prompted(runner, "hang")
        await runner.aclose()
        _ = task.cancel()
        with pytest.raises((asyncio.CancelledError, ToolError)):
            await task

    _, events = run_with_fake(tmp_path, scenario)

    assert "close_session" in names(events)


def test_no_new_work_after_the_call_ends(tmp_path: Path) -> None:
    async def scenario(runner: ClaudeRunner) -> None:
        _ = await runner.run("turns")
        await runner.aclose()
        with pytest.raises(ToolError, match="call is ending"):
            _ = await runner.run("turns")

    _, events = run_with_fake(tmp_path, scenario)

    assert names(events).count("initialize") == 1  # never respawned


def test_permission_requests_are_approved_once(tmp_path: Path) -> None:
    result, _ = run_with_fake(tmp_path, lambda r: r.run("permission"))

    assert result == "chose once"


def test_a_missing_adapter_is_reported_to_the_model(tmp_path: Path) -> None:
    runner = ClaudeRunner(
        command=str(tmp_path / "missing"),
        project=Project(name="test", folders=(tmp_path,)),
        env=os.environ,
    )

    with pytest.raises(ToolError, match="could not start"):
        _ = asyncio.run(runner.run("reply ok"))


def test_project_comes_from_job_metadata(tmp_path: Path) -> None:
    metadata = json.dumps({"project": "samba", "folders": [str(tmp_path)]})

    project = Project.from_job(metadata, {})

    assert project == Project(name="samba", folders=(tmp_path,))


def test_project_falls_back_to_the_environment(tmp_path: Path) -> None:
    other = tmp_path / "other"
    other.mkdir()
    environ = {
        "CLAUDE_PROJECT": "console",
        "CLAUDE_FOLDERS": os.pathsep.join([str(tmp_path), str(other)]),
    }

    project = Project.from_job("", environ)

    assert project.name == "console"
    assert project.cwd == tmp_path
    assert project.extra_folders == [str(other)]


def test_project_defaults_to_the_home_folder() -> None:
    assert Project.from_job("", {}) == Project(name="home", folders=(Path.home(),))


@pytest.mark.parametrize(
    ("metadata", "error"),
    [
        ("[]", "JSON object"),
        ('{"folders": "/tmp"}', "list of paths"),
        ('{"folders": ""}', "list of paths"),
        ('{"folders": ["relative/path"]}', "absolute path"),
        ('{"folders": ["~/Dev"]}', "absolute path"),
        ('{"folders": ["/no/such/folder"]}', "does not exist"),
    ],
)
def test_bad_project_metadata_is_rejected(metadata: str, error: str) -> None:
    with pytest.raises(ValueError, match=error):
        _ = Project.from_job(metadata, {})


def test_child_environment_drops_dotenv_secrets_and_api_keys() -> None:
    environ = {
        "PATH": "/bin",
        "SSH_AUTH_SOCK": "/tmp/agent",
        "GOOGLE_API_KEY": "g",
        "ANTHROPIC_API_KEY": "a",
        "CLAUDECODE": "1",
    }

    assert child_environment(environ, {"GOOGLE_API_KEY"}) == {
        "PATH": "/bin",
        "SSH_AUTH_SOCK": "/tmp/agent",
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
