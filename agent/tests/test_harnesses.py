import asyncio
import json
import os
from pathlib import Path

import pytest
from livekit.agents.llm import ToolError

from acp_client.runner import AcpRunner, CallRunners
from harnesses import CLAUDE_CODE, CODEX, GOOSE, HARNESSES, OMP, OPENCODE, installed
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

    monkeypatch.setattr("acp_client.environment.dotenv_values", dotenv_values)
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


def test_a_runner_that_fails_to_close_doesnt_keep_the_others_open(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    runners = CallRunners(
        Project(name="test", folders=(tmp_path,)),
        {"claude": executable(tmp_path, "claude"), "omp": executable(tmp_path, "omp")},
        os.environ,
    )
    opened = [runners.get(CLAUDE_CODE), runners.get(OMP)]
    closed: list[AcpRunner] = []

    async def aclose(runner: AcpRunner) -> None:
        closed.append(runner)
        if runner is opened[0]:
            raise RuntimeError("stuck")

    monkeypatch.setattr(AcpRunner, "aclose", aclose)

    asyncio.run(runners.aclose())

    assert closed == opened
    assert "closing claude failed" in caplog.text


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


def test_gooses_key_fields_follow_its_provider_and_turn_its_keychain_off() -> None:
    keys = GOOSE.key_vars
    assert keys is not None and keys.setting == "provider"
    assert [k.name for k in keys.offered("openrouter")] == ["OPENROUTER_API_KEY"]
    assert [k.name for k in keys.offered("anthropic")] == ["ANTHROPIC_API_KEY"]
    # Signed in another way: nothing to save.
    assert keys.offered("github_copilot") == ()
    assert keys.offered(None) == ()
    # "Goose (Default)" goes by the provider the session resolves it to.
    assert keys.defaults == frozenset({"goose"})
    assert GOOSE.saved_keys_env == {"GOOSE_DISABLE_KEYRING": "1"}
    assert GOOSE.setup_files == ("~/.config/goose/config.yaml",)


def test_only_goose_names_setup_files_or_key_variables() -> None:
    # Every other agent is checked at every launch, and its keys come from ACP alone.
    for harness in HARNESSES.values():
        if harness.id != "goose":
            assert (harness.setup_files, harness.key_vars) == ((), None), harness.id
            assert not harness.saved_keys_env, harness.id
