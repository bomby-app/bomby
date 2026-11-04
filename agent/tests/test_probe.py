import asyncio
import dataclasses
import json
import os
import sys
from pathlib import Path
from typing import Any

import pytest

import probe as probe_cli
from acp_client.probe import Setup, probe
from harnesses import Harness

FAKE_AGENT = Path(__file__).resolve().parent / "fake_claude_acp.py"
FAKE = Harness(
    id="fake",
    name="Fake",
    short_name="Fake",
    program="python",
    args=(str(FAKE_AGENT),),
)


def run_probe(
    tmp_path: Path, env: dict[str, str], harness: Harness = FAKE
) -> tuple[Setup, list[str]]:
    log = tmp_path / "acp.jsonl"
    environ = {**os.environ, **env, "FAKE_ACP_LOG": str(log)}
    setup = asyncio.run(probe(harness, Path(sys.executable), environ))
    lines = log.read_text().splitlines() if log.exists() else []
    events: list[dict[str, Any]] = [json.loads(line) for line in lines]
    return setup, [e["event"] for e in events]


CAN_DELETE = {"FAKE_ACP_CAN_DELETE": "1"}


def test_an_agent_with_a_model_is_ready(tmp_path: Path) -> None:
    setup, events = run_probe(tmp_path, {**CAN_DELETE, "FAKE_ACP_MODEL": "m1"})

    assert setup == Setup(ready=True, model="Fake m1")
    assert events == ["initialize", "new_session"]


def test_no_session_is_opened_in_an_agent_that_cant_delete_it(tmp_path: Path) -> None:
    setup, events = run_probe(tmp_path, {"FAKE_ACP_MODEL": "none"})

    assert setup == Setup(ready=True)
    assert events == ["initialize"]


def test_an_agent_without_a_model_needs_setup(tmp_path: Path) -> None:
    setup, _ = run_probe(
        tmp_path,
        {
            **CAN_DELETE,
            "FAKE_ACP_MODEL": "none",
            "FAKE_ACP_AUTH_METHODS": "Run `fake login` first",
        },
    )

    assert setup == Setup(ready=False, problem="No model is set", fix="fake login")


def test_a_refused_session_gives_the_agents_reason_and_fix(tmp_path: Path) -> None:
    setup, _ = run_probe(
        tmp_path,
        {
            **CAN_DELETE,
            "FAKE_ACP_REFUSE_SESSION": "Configuration value not found: GOOSE_PROVIDER",
            "FAKE_ACP_AUTH_METHODS": "Run `goose configure` to set up your provider",
        },
    )

    assert setup == Setup(
        ready=False,
        problem="Configuration value not found: GOOSE_PROVIDER",
        fix="goose configure",
    )


@pytest.mark.parametrize(
    ("kind", "expected"),
    [
        ("account", Setup(ready=True, account="Fake Pro")),
        ("none", Setup(ready=False, problem="Not signed in", fix="fake auth login")),
    ],
)
def test_an_agent_that_reports_its_sign_in_is_judged_by_it(
    tmp_path: Path, kind: str, expected: Setup
) -> None:
    harness = dataclasses.replace(FAKE, setup_command="fake auth login")

    setup, _ = run_probe(tmp_path, {"FAKE_ACP_AUTH_STATUS": kind}, harness)

    assert setup == expected


def test_a_program_that_wont_start_needs_setup(tmp_path: Path) -> None:
    setup = asyncio.run(probe(FAKE, tmp_path / "missing", dict(os.environ)))

    assert not setup.ready
    assert setup.problem == "It couldn't be started: No such file or directory"


def test_the_command_line_answers_by_agent_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_probe_all(
        agents: dict[str, tuple[Harness, Path]], _environ: object
    ) -> dict[str, Setup]:
        return {
            id: Setup(ready=True, model=str(program))
            for id, (_, program) in agents.items()
        }

    monkeypatch.setattr(probe_cli, "probe_all", fake_probe_all)

    out = probe_cli.main('{"agents": {"goose": "/bin/goose"}}')

    assert json.loads(out) == {
        "goose": {
            "ready": True,
            "problem": None,
            "fix": None,
            "account": None,
            "model": "/bin/goose",
            "adapter": None,
        }
    }


def test_an_agent_without_its_adapter_asks_for_it(tmp_path: Path) -> None:
    harness = dataclasses.replace(FAKE, adapter="fake-acp", adapter_env="FAKE_ACP_BIN")
    environ = {**os.environ, "FAKE_ACP_BIN": str(tmp_path / "missing")}

    setup = asyncio.run(probe(harness, Path(sys.executable), environ))

    assert setup == Setup(
        ready=False, problem="Its ACP adapter isn't set up", adapter="fake-acp"
    )
