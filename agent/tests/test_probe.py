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
from acp_client.settings import Pick, Skipped, saved_picks
from harnesses import Harness
from job import read_metadata

FAKE_AGENT = Path(__file__).resolve().parent / "fake_claude_acp.py"
FAKE = Harness(
    id="fake",
    short_name="Fake",
    program="python",
    args=(str(FAKE_AGENT),),
)


def run_probe(
    tmp_path: Path,
    env: dict[str, str],
    harness: Harness = FAKE,
    picks: tuple[Pick, ...] = (),
    listing: bool = False,
) -> tuple[Setup, list[str]]:
    log = tmp_path / "acp.jsonl"
    environ = {**os.environ, **env, "FAKE_ACP_LOG": str(log)}
    setup = asyncio.run(probe(harness, Path(sys.executable), environ, picks, listing))
    lines = log.read_text().splitlines() if log.exists() else []
    events: list[dict[str, Any]] = [json.loads(line) for line in lines]
    return setup, [e["event"] for e in events]


CAN_DELETE = {"FAKE_ACP_CAN_DELETE": "1"}


def ids(setup: Setup) -> list[str]:
    return [s.id for s in setup.settings]


def test_an_agent_with_a_model_is_ready(tmp_path: Path) -> None:
    setup, events = run_probe(tmp_path, {**CAN_DELETE, "FAKE_ACP_MODEL": "m1"})

    assert setup.ready
    assert setup.model == "Fake m1"
    assert events == ["initialize", "new_session"]


def test_listing_offers_the_model_and_effort_not_the_mode(tmp_path: Path) -> None:
    setup, _ = run_probe(tmp_path, {**CAN_DELETE, "FAKE_ACP_MODEL": "m1"}, listing=True)

    assert ids(setup) == ["model", "effort"]
    model = setup.settings[0]
    assert (model.current, [o.value for o in model.options]) == ("m1", ["m1", "m2"])


def test_a_harness_can_add_a_setting_the_agent_lists_without_a_category(
    tmp_path: Path,
) -> None:
    harness = dataclasses.replace(FAKE, pickable_settings=frozenset({"provider"}))

    setup, _ = run_probe(
        tmp_path, {**CAN_DELETE, "FAKE_ACP_MODEL": "m1"}, harness, listing=True
    )

    assert ids(setup) == ["provider", "model", "effort"]


def test_the_background_check_leaves_the_option_lists_out(tmp_path: Path) -> None:
    setup, _ = run_probe(tmp_path, {**CAN_DELETE, "FAKE_ACP_MODEL": "m1"})

    assert setup.settings == ()


def test_saved_choices_are_applied_in_order_and_the_settings_follow(
    tmp_path: Path,
) -> None:
    harness = dataclasses.replace(FAKE, pickable_settings=frozenset({"provider"}))
    picks = (Pick("provider", "p2"), Pick("model", "p2-model"))

    setup, events = run_probe(
        tmp_path, {**CAN_DELETE, "FAKE_ACP_MODEL": "m1"}, harness, picks
    )

    assert setup.ready
    assert setup.model == "Fake p2-model"
    # The model was already p2-model once the provider changed, so it isn't sent again.
    assert events.count("set_config_option") == 1


def test_picks_apply_in_the_agents_order_whatever_order_they_were_saved_in(
    tmp_path: Path,
) -> None:
    harness = dataclasses.replace(FAKE, pickable_settings=frozenset({"provider"}))
    # The model only exists once the provider is p2, which the agent lists first.
    picks = (Pick("model", "p2-model"), Pick("provider", "p2"))

    setup, _ = run_probe(
        tmp_path, {**CAN_DELETE, "FAKE_ACP_MODEL": "m1"}, harness, picks
    )

    assert (setup.model, setup.skipped) == ("Fake p2-model", ())


def test_a_pick_the_agent_no_longer_offers_leaves_its_default(tmp_path: Path) -> None:
    setup, _ = run_probe(
        tmp_path,
        {**CAN_DELETE, "FAKE_ACP_MODEL": "m1"},
        picks=(Pick("model", "retired"),),
    )

    assert setup.ready
    assert setup.model == "Fake m1"
    assert setup.skipped == (Skipped("model", "Model", "retired", "gone"),)


def test_a_pick_the_agent_refuses_leaves_its_default_and_the_rest_apply(
    tmp_path: Path,
) -> None:
    harness = dataclasses.replace(FAKE, pickable_settings=frozenset({"provider"}))
    picks = (Pick("provider", "p3"), Pick("effort", "high"))

    setup, _ = run_probe(
        tmp_path, {**CAN_DELETE, "FAKE_ACP_MODEL": "m1"}, harness, picks, listing=True
    )

    assert setup.ready, "a refused pick isn't a sign-in problem"
    assert setup.skipped == (Skipped("provider", "Provider", "p3", "refused"),)
    assert {s.id: s.current for s in setup.settings} == {
        "provider": "p1",
        "model": "m1",
        "effort": "high",
    }


PICK_REQUIRED = dataclasses.replace(FAKE, model_selection_required=True)


def test_an_agent_that_requires_a_pick_waits_for_one(tmp_path: Path) -> None:
    setup, _ = run_probe(
        tmp_path, {**CAN_DELETE, "FAKE_ACP_MODEL": "m1"}, PICK_REQUIRED
    )

    assert not setup.ready
    assert setup.needs_pick
    assert setup.model == "Fake m1", "it still says what it would run on"


@pytest.mark.parametrize(
    ("picks", "ready"),
    [
        ((Pick("model", "m2"),), True),
        ((Pick("model", "retired"),), False),
        ((Pick("effort", "high"),), False),
    ],
    ids=["model picked", "pick gone", "only effort picked"],
)
def test_an_agent_that_requires_a_pick_is_ready_once_its_model_is_picked(
    tmp_path: Path, picks: tuple[Pick, ...], ready: bool
) -> None:
    setup, _ = run_probe(
        tmp_path, {**CAN_DELETE, "FAKE_ACP_MODEL": "m1"}, PICK_REQUIRED, picks
    )

    assert (setup.ready, setup.needs_pick) == (ready, not ready)


def test_listing_opens_and_closes_a_session_the_agent_cant_delete(
    tmp_path: Path,
) -> None:
    setup, events = run_probe(tmp_path, {"FAKE_ACP_MODEL": "m1"}, listing=True)

    assert setup.model == "Fake m1"
    assert events == ["initialize", "new_session", "close_session"]


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

    assert setup == Setup(
        ready=False, problem="No model is set", fix="fake login", session=True
    )


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
        agents: dict[str, tuple[Harness, Path]], *_args: object
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
            "skipped": [],
            "needs_pick": False,
            "session": False,
            "settings": [],
        }
    }


def test_the_command_line_reads_the_picks_and_who_to_list() -> None:
    fields = read_metadata(
        '{"picks": {"goose": [{"setting": "provider", "value": "p2"}]},'
        + ' "listing": ["omp"]}'
    )

    assert saved_picks(fields) == {"goose": [Pick("provider", "p2")]}
    assert probe_cli.listing(fields) == {"omp"}


@pytest.mark.parametrize(
    "metadata",
    [
        '{"picks": []}',
        '{"picks": {"goose": [{"setting": 1}]}}',
        '{"listing": "omp"}',
    ],
)
def test_the_command_line_rejects_bad_choices(metadata: str) -> None:
    with pytest.raises(ValueError, match="picks|listing"):
        _ = read_metadata(metadata)


def test_the_command_line_reads_no_choices_as_none() -> None:
    fields = read_metadata('{"agents": {}}')
    assert saved_picks(fields) == {}
    assert probe_cli.listing(fields) == frozenset()


def test_an_agent_without_its_adapter_asks_for_it(tmp_path: Path) -> None:
    harness = dataclasses.replace(FAKE, adapter="fake-acp", adapter_env="FAKE_ACP_BIN")
    environ = {**os.environ, "FAKE_ACP_BIN": str(tmp_path / "missing")}

    setup = asyncio.run(probe(harness, Path(sys.executable), environ))

    assert setup == Setup(
        ready=False, problem="Its ACP adapter isn't set up", adapter="fake-acp"
    )
