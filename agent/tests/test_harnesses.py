import asyncio
import json
import os
from pathlib import Path

import pytest
from livekit.agents.llm import ToolError

from acp_client import CallRunners
from harnesses import CLAUDE_CODE, HARNESSES, OMP, OPENCODE, installed
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

    assert installed(metadata, HARNESSES, {}) == {
        "claude": Path("/usr/local/bin/claude")
    }


def test_a_call_with_no_agents_has_none() -> None:
    assert installed(json.dumps({"project": "samba"}), HARNESSES, {}) == {}


@pytest.mark.parametrize(
    "agents", ['{"claude": "claude"}', '{"claude": 3}', '["claude"]']
)
def test_bad_agents_are_rejected(agents: str) -> None:
    with pytest.raises(ValueError, match="agent"):
        _ = installed(f'{{"agents": {agents}}}', HARNESSES, {})


def test_console_runs_find_agents_on_path(tmp_path: Path) -> None:
    opencode = executable(tmp_path, "opencode")

    found = installed("", HARNESSES, {"PATH": str(tmp_path)})

    assert found == {"opencode": opencode}


def test_a_native_agent_runs_its_own_program() -> None:
    command, args, env = OPENCODE.launch("/bin/opencode", {"PATH": "/bin"}, {})

    assert (command, args, env) == ("/bin/opencode", ("acp",), {"PATH": "/bin"})
    assert OMP.launch("/bin/omp", {}, {})[:2] == ("/bin/omp", ("acp",))


def test_an_adapter_gets_the_agents_program_in_its_environment() -> None:
    command, args, env = CLAUDE_CODE.launch("/bin/claude", {"PATH": "/bin"}, {})

    assert (command, args) == ("claude-agent-acp", ())
    assert env == {"PATH": "/bin", "CLAUDE_CODE_EXECUTABLE": "/bin/claude"}


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
        {"opencode": executable(tmp_path, "opencode")},
        os.environ,
    )

    assert runners.available == [OPENCODE]
    assert runners.get(OPENCODE) is runners.get(OPENCODE)
    with pytest.raises(ToolError, match="Claude isn't ready right now"):
        _ = runners.get(CLAUDE_CODE)
    asyncio.run(runners.aclose())
