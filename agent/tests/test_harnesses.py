import asyncio
import json
import os
from pathlib import Path

import pytest
from livekit.agents.llm import ToolError

from acp_client import CallRunners
from harnesses import CLAUDE_CODE, CODEX, HARNESSES, OMP, OPENCODE, installed
from harnesses.harness import ADAPTERS, Harness
from job import Pick, read_metadata
from project import Project


def executable(folder: Path, name: str) -> Path:
    path = folder / name
    _ = path.write_text("#!/bin/sh\n")
    path.chmod(0o755)
    return path


def test_installed_agents_come_from_the_job_metadata() -> None:
    metadata = json.dumps(
        {"agents": {"claude": "/usr/local/bin/claude", "pi": "/bin/pi"}}
    )

    assert installed(read_metadata(metadata), HARNESSES, {}) == {
        "claude": Path("/usr/local/bin/claude")
    }


def test_a_call_with_no_agents_has_none() -> None:
    assert installed(read_metadata('{"project": "samba"}'), HARNESSES, {}) == {}


@pytest.mark.parametrize(
    "agents", ['{"claude": "claude"}', '{"claude": 3}', '["claude"]']
)
def test_bad_agents_are_rejected(agents: str) -> None:
    with pytest.raises(ValueError, match="agent"):
        _ = installed(read_metadata(f'{{"agents": {agents}}}'), HARNESSES, {})


def test_console_runs_find_agents_on_path(tmp_path: Path) -> None:
    opencode = executable(tmp_path, "opencode")

    found = installed(None, HARNESSES, {"PATH": str(tmp_path)})

    assert found == {"opencode": opencode}


def test_a_native_agent_runs_its_own_program() -> None:
    command, args, env = OPENCODE.launch("/bin/opencode", {"PATH": "/bin"}, {})

    assert (command, args, env) == ("/bin/opencode", ("acp",), {"PATH": "/bin"})
    assert OMP.launch("/bin/omp", {}, {})[:2] == ("/bin/omp", ("acp",))


def test_an_adapter_gets_the_agents_program_in_its_environment() -> None:
    command, args, env = CLAUDE_CODE.launch("/bin/claude", {"PATH": "/bin"}, {})

    assert (command, args) == (str(ADAPTERS / "claude-agent-acp"), ())
    assert env == {"PATH": "/bin", "CLAUDE_CODE_EXECUTABLE": "/bin/claude"}


def test_codex_runs_through_its_adapter_on_the_users_codex() -> None:
    command, args, env = CODEX.launch("/bin/codex", {"PATH": "/bin"}, {})

    assert (command, args) == (str(ADAPTERS / "codex-acp"), ())
    assert env == {"PATH": "/bin", "CODEX_PATH": "/bin/codex"}
    assert CODEX.launch("/bin/codex", {}, {"CODEX_ACP_BIN": "/x/codex-acp"})[0] == (
        "/x/codex-acp"
    )


def test_an_adapter_override_in_agent_env_is_used_but_not_passed_on(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # CLAUDE_ACP_BIN in agent/.env is a .env key, so it's kept out of the agent's
    # environment, yet it still picks the adapter (review finding, 2026-11-04).
    def dotenv_values(_: object) -> dict[str, str]:
        return {"CLAUDE_ACP_BIN": "/x/acp"}

    monkeypatch.setattr("acp_client.runner.dotenv_values", dotenv_values)
    runners = CallRunners(
        Project(name="test", folders=(tmp_path,)),
        {"claude": executable(tmp_path, "claude")},
        {"PATH": "/bin", "CLAUDE_ACP_BIN": "/x/acp"},
    )

    runner = runners.get(CLAUDE_CODE)

    assert runner.command == "/x/acp"
    assert "CLAUDE_ACP_BIN" not in runner.env
    asyncio.run(runners.aclose())


def test_only_installed_agents_are_available(tmp_path: Path) -> None:
    runners = CallRunners(
        Project(name="test", folders=(tmp_path,)),
        {"omp": executable(tmp_path, "omp")},
        os.environ,
    )

    assert runners.available == [OMP]
    assert runners.get(OMP) is runners.get(OMP)
    with pytest.raises(ToolError, match="Claude isn't ready right now"):
        _ = runners.get(CLAUDE_CODE)
    asyncio.run(runners.aclose())


@pytest.mark.parametrize(
    ("picks", "available"),
    [
        ({}, [CLAUDE_CODE]),
        ({"opencode": (Pick("model", "m1"),)}, [CLAUDE_CODE, OPENCODE]),
    ],
    ids=["nothing picked, as on a console run", "its model picked"],
)
def test_an_agent_that_requires_a_pick_is_offered_only_once_something_is_picked(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
    picks: dict[str, tuple[Pick, ...]],
    available: list[Harness],
) -> None:
    runners = CallRunners(
        Project(name="test", folders=(tmp_path,)),
        {
            "claude": executable(tmp_path, "claude"),
            "opencode": executable(tmp_path, "opencode"),
        },
        os.environ,
        picks,
    )

    assert runners.available == available
    assert ("left out of the call" in caplog.text) == (OPENCODE not in available)
    if OPENCODE not in available:
        with pytest.raises(ToolError, match="OpenCode isn't ready right now"):
            _ = runners.get(OPENCODE)
