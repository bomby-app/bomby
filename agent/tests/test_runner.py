import asyncio
import dataclasses
import json
import logging
import os
import sys
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from typing import Any

import pytest
from acp.schema import PermissionOption
from livekit.agents.llm import ToolError

import acp_client.runner as runner_module
from acp_client.client import pick_allow
from acp_client.environment import AGENT_KEYS_ENV, child_environment
from acp_client.runner import (
    BRIEFING,
    NOT_READY_LINE,
    REPORT_RULE,
    SHORT_REPORT_RULE,
    AcpRunner,
    Turn,
    briefing,
    no_model_picked,
    no_report,
    not_ready,
    report_not_ready,
    steered_note,
    stopped,
)
from harnesses import CLAUDE_CODE, CODEX, GOOSE, Harness
from job import Pick
from project import Project

FAKE_AGENT = Path(__file__).resolve().parent / "fake_claude_acp.py"


def run_with_fake(
    tmp_path: Path,
    scenario: Callable[[AcpRunner], Awaitable[Any]],
    *,
    folders: tuple[Path, ...] | None = None,
    env: Mapping[str, str] | None = None,
    harness: Harness = CLAUDE_CODE,
    picks: tuple[Pick, ...] = (),
) -> tuple[Any, list[dict[str, Any]]]:
    """Run `scenario` against the fake ACP agent; return its result and the agent's log."""
    log = tmp_path / "acp.jsonl"
    runner = AcpRunner(
        harness=harness,
        command=sys.executable,
        args=[str(FAKE_AGENT)],
        project=Project(name="test", folders=folders or (tmp_path,)),
        env={**os.environ, **(env or {}), "FAKE_ACP_LOG": str(log)},
        picks=picks,
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


def logged(runner: AcpRunner, event: str, **fields: object) -> int:
    """How many times the fake agent has logged `event` with `fields`."""
    log = Path(runner.env["FAKE_ACP_LOG"])
    if not log.exists():
        return 0
    count = 0
    # Only whole lines: the fake may be part-way through writing the last one.
    for line in log.read_text().splitlines(keepends=True):
        if not line.endswith("\n"):
            continue
        entry = json.loads(line)
        count += entry["event"] == event and all(
            entry.get(k) == v for k, v in fields.items()
        )
    return count


async def until_logged(
    runner: AcpRunner, event: str, before: int = 0, **fields: object
) -> None:
    """Until the fake agent has logged `event` with `fields` more than `before` times. A
    fixed sleep races a loaded machine."""
    for _ in range(400):
        if logged(runner, event, **fields) > before:
            return
        await asyncio.sleep(0.05)
    raise AssertionError(f"the agent never logged {event} {fields}")


async def until_prompted(
    runner: AcpRunner, task: str, session: str = "main"
) -> asyncio.Task[str]:
    """Start `task` in `session` and return once the fake agent has its prompt."""
    before = logged(runner, "prompt", text=task)
    running = asyncio.create_task(text(runner.run(task, session)))
    # A cancel sent before the prompt landed was lost.
    await until_logged(runner, "prompt", before, text=task)
    return running


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


def test_a_turn_without_a_final_message_fails_instead_of_reading_as_done(
    tmp_path: Path,
) -> None:
    async def scenario(runner: AcpRunner) -> str:
        with pytest.raises(ToolError) as error:
            _ = await runner.run("silent")
        return str(error.value)

    message, _ = run_with_fake(tmp_path, scenario)

    assert message == no_report(CLAUDE_CODE)


def test_each_session_gets_the_model_and_effort_the_agent_was_set_up_with(
    tmp_path: Path,
) -> None:
    picks = (Pick("model", "m2"), Pick("effort", "high"))

    _, events = run_with_fake(
        tmp_path,
        lambda r: text(r.run("reply ok")),
        env={"FAKE_ACP_MODEL": "m1"},
        picks=picks,
    )

    set_ = [
        (e["config_id"], e["value"])
        for e in events
        if e["event"] == "set_config_option"
    ]
    assert set_ == [("model", "m2"), ("effort", "high")]
    assert names(events).index("set_config_option") < names(events).index("prompt")


@pytest.mark.parametrize("dropped", [Pick("model", "retired"), Pick("mode", "x")])
def test_a_pick_the_agent_dropped_leaves_its_default(
    tmp_path: Path, dropped: Pick
) -> None:
    result, events = run_with_fake(
        tmp_path,
        lambda r: text(r.run("reply ok")),
        env={"FAKE_ACP_MODEL": "m1"},
        picks=(dropped, Pick("effort", "high")),
    )

    assert result == "Done: ok"
    set_ = [
        (e["config_id"], e["value"])
        for e in events
        if e["event"] == "set_config_option"
    ]
    assert set_ == [("effort", "high")]


def test_a_pick_the_agent_refuses_never_fails_the_task(tmp_path: Path) -> None:
    goose_like = dataclasses.replace(
        CLAUDE_CODE, pickable_settings=frozenset({"provider"})
    )

    result, events = run_with_fake(
        tmp_path,
        lambda r: text(r.run("reply ok")),
        env={"FAKE_ACP_MODEL": "m1"},
        harness=goose_like,
        picks=(Pick("provider", "p3"),),
    )

    assert result == "Done: ok"
    assert names(events).count("new_session") == 1, "no session left behind to retry"


@pytest.mark.parametrize(
    ("env", "ended"),
    [({}, "close_session"), ({"FAKE_ACP_CAN_DELETE": "1"}, "delete_session")],
    ids=["closed", "deleted where it can be"],
)
def test_an_agent_whose_model_pick_is_gone_takes_no_task(
    tmp_path: Path, env: dict[str, str], ended: str
) -> None:
    pick_required = dataclasses.replace(CLAUDE_CODE, model_selection_required=True)

    message, events = run_with_fake(
        tmp_path,
        tool_error,
        env={**env, "FAKE_ACP_MODEL": "m1"},
        harness=pick_required,
        picks=(Pick("model", "retired"),),
    )

    assert message == no_model_picked(pick_required)
    assert names(events) == ["initialize", "new_session", "set_session_mode", ended]


def test_an_agent_that_requires_a_pick_but_lists_no_model_isnt_ready(
    tmp_path: Path,
) -> None:
    # Nothing to pick: its own setup lacks a model, as Settings says.
    pick_required = dataclasses.replace(CLAUDE_CODE, model_selection_required=True)

    message, _ = run_with_fake(
        tmp_path, tool_error, harness=pick_required, picks=(Pick("model", "m1"),)
    )

    assert message == not_ready(pick_required)


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


def test_the_briefing_keeps_the_length_rule_that_short_reports_replace() -> None:
    assert REPORT_RULE in BRIEFING


def test_short_reports_hold_information_tasks_to_100_words_too(tmp_path: Path) -> None:
    project = Project(name="samba", folders=(tmp_path,))

    assert REPORT_RULE in briefing(project)
    short = briefing(project, short_reports=True)
    assert SHORT_REPORT_RULE in short
    assert REPORT_RULE not in short


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
        # Stopped only once it joined: a request too late for the turn takes its own.
        await until_logged(runner, "steer", text="make the header blue", injected=True)
        _ = first.cancel()
        with pytest.raises(ToolError) as stopped_error:
            _ = await steered
        return str(stopped_error.value)

    message, events = run_with_fake(tmp_path, scenario)

    assert message == stopped(CLAUDE_CODE)
    assert [e["text"] for e in events if e["event"] == "prompt"] == ["hang"]


def test_a_steered_request_fails_when_the_turn_it_joined_stops_early(
    tmp_path: Path,
) -> None:
    async def scenario(runner: AcpRunner) -> tuple[str, str]:
        first = await until_prompted(runner, "cutoff Half done.", "page")
        with pytest.raises(ToolError) as error:
            _ = await runner.run("make the header blue", "page")
        return await first, str(error.value)

    (first, steered), _ = run_with_fake(tmp_path, scenario)

    assert first.startswith("Claude stopped early (max_tokens)")
    assert steered == stopped(CLAUDE_CODE)


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
        taken = asyncio.Event()

        async def on_start() -> None:
            taken.set()

        second = asyncio.create_task(text(runner.run("turns", on_start=on_start)))
        await asyncio.sleep(0.5)
        assert not second.done()  # queued behind the running turn
        assert not taken.is_set()  # and not taken yet
        _ = first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        result = await second
        assert taken.is_set()
        return [result]

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
        failed = await tool_error(runner, "fail-after-work Rate limited")
        crashed = await tool_error(runner, "crash out of memory")
        return failed, crashed, (await runner.run("reply back")).text

    (failed, crashed, after), _ = run_with_fake(tmp_path, scenario)

    stopped = (
        "Claude stopped before finishing. Say sorry and offer to try again or to try "
        "another agent."
    )
    assert failed == crashed == stopped
    assert after == "Done: back"


def gone(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    return False


@pytest.mark.parametrize("step", ["initialize", "new_session"])
def test_an_agent_that_never_answers_is_stopped_and_the_next_task_restarts_it(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    step: str,
) -> None:
    monkeypatch.setattr(runner_module, "START_TIMEOUT_S", 0.5)

    async def scenario(runner: AcpRunner) -> tuple[str, str]:
        async with asyncio.timeout(10):  # a missing deadline fails, not hangs
            hung = await tool_error(runner)
            return hung, (await runner.run("reply back")).text

    (hung, after), events = run_with_fake(
        tmp_path, scenario, env={"FAKE_ACP_HANG": step}
    )

    assert hung == not_ready(CLAUDE_CODE)
    assert after == "Done: back"
    first, second = (e["pid"] for e in events if e["event"] == "initialize")
    assert first != second
    assert gone(first)
    what = "initialize" if step == "initialize" else "session/new"
    assert f"didn't answer {what} within 0.5 s" in caplog.text


@pytest.mark.parametrize("step", ["initialize", "new_session"])
def test_the_call_ends_promptly_while_an_agent_never_answers(
    tmp_path: Path, step: str
) -> None:
    async def scenario(runner: AcpRunner) -> str:
        running = asyncio.create_task(tool_error(runner))
        await until_logged(runner, "hang", step=step)
        async with asyncio.timeout(10):  # well inside the 30 s deadline
            await runner.aclose()
            return await running

    message, events = run_with_fake(tmp_path, scenario, env={"FAKE_ACP_HANG": step})

    assert message == "The call is ending; Claude takes no new work."
    pid = next(e["pid"] for e in events if e["event"] == "initialize")
    assert gone(pid)


async def stop(running: asyncio.Task[str]) -> None:
    """Cancels a request, as the user's Stop or the voice model's cancel does, and waits
    for it to be over."""
    _ = running.cancel()
    with pytest.raises(asyncio.CancelledError):
        _ = await running


def test_a_stopped_turn_is_over_only_once_the_agent_says_so(tmp_path: Path) -> None:
    # After a cancel the agent is still stopping its tools and sending its last updates:
    # the session's next request doesn't start, or hear those, until its turn has ended.
    async def scenario(runner: AcpRunner) -> str:
        await stop(await until_prompted(runner, "hang", "page"))
        return await text(runner.run("reply next", "page"))

    result, events = run_with_fake(
        tmp_path, scenario, env={"FAKE_ACP_SLOW_CANCEL": "0.4"}
    )

    assert result == "Done: next"
    turn = [n for n in names(events) if n in ("prompt", "cancel", "stopped")]
    assert turn == ["prompt", "cancel", "stopped", "prompt"]
    assert len([e for e in events if e["event"] == "initialize"]) == 1


def test_an_agent_that_wont_stop_is_stopped_itself(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(runner_module, "STOP_TIMEOUT_S", 0.3)

    async def scenario(runner: AcpRunner) -> str:
        async with asyncio.timeout(10):  # a missing deadline fails, not hangs
            await stop(await until_prompted(runner, "hang", "page"))
            return await text(runner.run("reply next", "page"))

    result, events = run_with_fake(
        tmp_path, scenario, env={"FAKE_ACP_SLOW_CANCEL": "30"}
    )

    # The session is never handed on with its old turn still going: a fresh agent
    # takes the next request.
    assert result == "Done: next"
    first, second = (e["pid"] for e in events if e["event"] == "initialize")
    assert first != second
    assert gone(first)
    assert "didn't stop within 0.3 s" in caplog.text


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
        "ZEP_API_KEY": "z",
        "CLAUDE_CODE_EXECUTABLE": "/usr/local/bin/claude",
    }

    assert child_environment(environ, set(), CLAUDE_CODE) == {
        "PATH": "/bin",
        "CLAUDE_CODE_EXECUTABLE": "/usr/local/bin/claude",
    }


def test_each_agent_gets_only_its_own_saved_keys() -> None:
    saved = {
        "goose": {"OPENROUTER_API_KEY": "sk-or", "OPENAI_API_KEY": "sk-goose-openai"},
        "claude": {"OTHER_API_KEY": "sk-other"},
    }
    environ = {
        "PATH": "/bin",
        AGENT_KEYS_ENV: json.dumps(saved),
        # Bomby's own voice keys.
        "OPENAI_API_KEY": "sk-voice-openai",
        "GOOGLE_API_KEY": "sk-voice-gemini",
    }

    goose = child_environment(environ, set(), GOOSE)
    codex = child_environment(environ, set(), CODEX)

    # Saved for goose, OPENAI_API_KEY is goose's own, not the voice's; the voice's Gemini
    # key and every other agent's keys stay out, and so does the list of them all.
    assert goose == {
        "PATH": "/bin",
        "OPENROUTER_API_KEY": "sk-or",
        "OPENAI_API_KEY": "sk-goose-openai",
        **GOOSE.saved_keys_env,
    }
    assert codex == {"PATH": "/bin"}


def test_an_agent_without_saved_keys_runs_as_before() -> None:
    environ = {
        "PATH": "/bin",
        AGENT_KEYS_ENV: json.dumps({"codex": {"X_API_KEY": "x"}}),
    }

    assert child_environment(environ, set(), GOOSE) == {"PATH": "/bin"}
    assert "GOOSE_DISABLE_KEYRING" not in child_environment({}, set(), GOOSE)


@pytest.mark.parametrize(
    "value", ["not json", "[]", '{"goose": "sk"}', '{"goose": {"K": 1}}']
)
def test_saved_keys_that_cant_be_read_reach_no_agent(value: str) -> None:
    environ = {"PATH": "/bin", AGENT_KEYS_ENV: value}

    assert child_environment(environ, set(), GOOSE) == {"PATH": "/bin"}


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


def test_a_turn_refused_before_any_work_is_not_ready_and_reported_to_the_app(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    # goose with a wrong key: the session opens, the first prompt fails.
    with caplog.at_level(logging.WARNING):
        (refused, _) = run_with_fake(
            tmp_path, lambda runner: tool_error(runner, "fail 401 Unauthorized")
        )
    assert refused == not_ready(CLAUDE_CODE)
    record = next(r for r in caplog.records if r.getMessage() == NOT_READY_LINE)
    assert record.__dict__["not_ready"] == "claude"


def test_a_harness_not_ready_on_a_call_is_logged_for_the_app(
    caplog: pytest.LogCaptureFixture,
) -> None:
    # The core reads this line from the worker's log (`not_ready` in agent.rs).
    with caplog.at_level(logging.WARNING):
        report_not_ready(CLAUDE_CODE)

    record = next(r for r in caplog.records if r.getMessage() == NOT_READY_LINE)
    assert record.__dict__["not_ready"] == "claude"
