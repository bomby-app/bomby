import asyncio
import dataclasses
import json
import os
import subprocess
import sys
from collections.abc import Collection
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

import acp_client.probe as probe_module
import probe as probe_cli
from acp_client.environment import AGENT_KEYS_ENV
from acp_client.probe import KeyField, Setup, probe, probe_all, redact
from acp_client.redaction import secrets_to_redact
from acp_client.settings import Skipped
from harnesses import Harness
from harnesses.harness import KeyVar, KeyVars
from job import Pick, read_metadata

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
    open_session: bool = False,
) -> tuple[Setup, list[str]]:
    log = tmp_path / "acp.jsonl"
    environ = {**os.environ, **env, "FAKE_ACP_LOG": str(log)}
    setup = asyncio.run(
        probe(harness, Path(sys.executable), environ, picks, listing, open_session)
    )
    lines = log.read_text().splitlines() if log.exists() else []
    events: list[dict[str, Any]] = [json.loads(line) for line in lines]
    return setup, [e["event"] for e in events]


CAN_DELETE = {"FAKE_ACP_CAN_DELETE": "1"}


def ids(setup: Setup) -> list[str]:
    return [s.id for s in setup.settings]


def test_an_agent_with_a_model_is_ready(tmp_path: Path) -> None:
    setup, events = run_probe(tmp_path, {**CAN_DELETE, "FAKE_ACP_MODEL": "m1"})

    assert setup.step == "ready"
    assert setup.model == "Fake m1"
    assert events == ["initialize", "new_session", "delete_session"]


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


def test_saved_picks_are_applied_in_order_and_the_settings_follow(
    tmp_path: Path,
) -> None:
    harness = dataclasses.replace(FAKE, pickable_settings=frozenset({"provider"}))
    picks = (Pick("provider", "p2"), Pick("model", "p2-model"))

    setup, events = run_probe(
        tmp_path, {**CAN_DELETE, "FAKE_ACP_MODEL": "m1"}, harness, picks
    )

    assert setup.step == "ready"
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

    assert setup.step == "ready"
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

    assert setup.step == "ready", "a refused pick isn't a sign-in problem"
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

    assert (setup.step, setup.problem) == ("pick", "Pick its model")
    assert setup.model == "Fake m1", "it still says what it would run on"


@pytest.mark.parametrize(
    ("picks", "step"),
    [
        ((Pick("model", "m2"),), "ready"),
        ((Pick("model", "m1"),), "ready"),
        ((Pick("model", "retired"),), "pick"),
        ((Pick("effort", "high"),), "pick"),
    ],
    ids=[
        "model picked",
        "the model it runs on picked",
        "pick gone",
        "only effort picked",
    ],
)
def test_an_agent_that_requires_a_pick_is_ready_once_its_model_is_picked(
    tmp_path: Path, picks: tuple[Pick, ...], step: str
) -> None:
    setup, _ = run_probe(
        tmp_path, {**CAN_DELETE, "FAKE_ACP_MODEL": "m1"}, PICK_REQUIRED, picks
    )

    assert setup.step == step


@pytest.mark.parametrize(
    ("picks", "step"),
    [((), "pick"), ((Pick("effort", "high"),), "ready")],
    ids=["nothing picked", "something picked"],
)
def test_without_a_session_any_pick_counts_for_an_agent_that_requires_one(
    tmp_path: Path, picks: tuple[Pick, ...], step: str
) -> None:
    setup, events = run_probe(tmp_path, {"FAKE_ACP_MODEL": "m1"}, PICK_REQUIRED, picks)

    assert setup.step == step
    assert events == ["initialize"]


def test_listing_opens_and_closes_a_session_the_agent_cant_delete(
    tmp_path: Path,
) -> None:
    setup, events = run_probe(tmp_path, {"FAKE_ACP_MODEL": "m1"}, listing=True)

    assert setup.model == "Fake m1"
    assert events == ["initialize", "new_session", "close_session"]


def test_a_session_asked_for_is_opened_and_closed_without_the_option_lists(
    tmp_path: Path,
) -> None:
    # The app asks once per launch, so omp's setup is checked, not assumed.
    setup, events = run_probe(tmp_path, {"FAKE_ACP_MODEL": "m1"}, open_session=True)

    assert (setup.step, setup.model, setup.session) == ("ready", "Fake m1", True)
    assert setup.settings == ()
    assert events == ["initialize", "new_session", "close_session"]


def test_no_session_is_opened_in_an_agent_that_cant_delete_it(tmp_path: Path) -> None:
    setup, events = run_probe(tmp_path, {"FAKE_ACP_MODEL": "none"})

    assert setup == Setup("ready")
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
        "sign_in", problem="No model is set", fix="fake login", session=True
    )


def test_an_agent_that_requires_a_pick_but_lists_no_model_needs_setup(
    tmp_path: Path,
) -> None:
    # Nothing to pick, so it isn't asked for one: the agent itself has no model.
    setup, _ = run_probe(tmp_path, CAN_DELETE, PICK_REQUIRED)

    assert setup.step == "sign_in"
    assert setup.problem == "No model is set"


def test_an_answer_the_probe_cant_read_costs_only_that_agent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def unreadable(*_: object) -> Setup:
        raise ValueError("bad config option")

    monkeypatch.setattr("acp_client.probe._check", unreadable)
    setup, _ = run_probe(tmp_path, CAN_DELETE)

    assert setup == Setup(
        "unreachable",
        problem="It answered in a way Bomby can't read: bad config option",
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
        "sign_in",
        problem="Configuration value not found: GOOSE_PROVIDER",
        fix="goose configure",
    )


@pytest.mark.parametrize(
    ("kind", "expected"),
    [
        ("account", Setup("ready", account="Fake Pro")),
        ("none", Setup("sign_in", problem="Not signed in", fix="fake auth login")),
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

    assert setup == Setup(
        "unreachable", problem="It couldn't be started: No such file or directory"
    )


def test_the_command_line_answers_by_agent_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_probe_all(
        agents: dict[str, tuple[Harness, Path]], *_args: object
    ) -> dict[str, Setup]:
        return {
            id: Setup("ready", model=str(program))
            for id, (_, program) in agents.items()
        }

    monkeypatch.setattr(probe_cli, "probe_all", fake_probe_all)

    out = probe_cli.main('{"agents": {"goose": "/bin/goose"}}')

    assert json.loads(out) == {
        "goose": {
            "step": "ready",
            "problem": None,
            "fix": None,
            "account": None,
            "model": "/bin/goose",
            "adapter": None,
            "skipped": [],
            "session": False,
            "settings": [],
            "keys": [],
            "setup_files": [],
        }
    }


@pytest.mark.parametrize(
    ("metadata", "picks", "listing", "sessions"),
    [
        (
            '{"picks": {"goose": [{"setting": "provider", "value": "p2"}]},'
            + ' "listing": ["omp"], "sessions": ["omp"]}',
            {"goose": (Pick("provider", "p2"),)},
            {"omp"},
            {"omp"},
        ),
        ('{"agents": {}}', {}, set[str](), set[str]()),
        ("", {}, set[str](), set[str]()),
    ],
    ids=["picks, listing and sessions", "none", "no metadata"],
)
def test_the_command_line_passes_on_the_picks_and_who_to_list(
    monkeypatch: pytest.MonkeyPatch,
    metadata: str,
    picks: dict[str, tuple[Pick, ...]],
    listing: set[str],
    sessions: set[str],
) -> None:
    passed: list[tuple[object, set[str], set[str]]] = []

    async def fake_probe_all(
        _agents: object,
        _environ: object,
        picks: object,
        listing: Collection[str],
        sessions: Collection[str],
    ) -> dict[str, Setup]:
        passed.append((picks, set(listing), set(sessions)))
        return {}

    monkeypatch.setattr(probe_cli, "probe_all", fake_probe_all)

    _ = probe_cli.main(metadata)

    assert passed == [(picks, listing, sessions)]


@pytest.mark.parametrize(
    "metadata",
    [
        '{"picks": []}',
        '{"picks": {"goose": [{"setting": 1}]}}',
        '{"listing": "omp"}',
    ],
)
def test_the_command_line_rejects_bad_picks(metadata: str) -> None:
    with pytest.raises(ValueError, match="picks|listing"):
        _ = read_metadata(metadata)


def test_an_agent_without_its_adapter_asks_for_it(tmp_path: Path) -> None:
    harness = dataclasses.replace(FAKE, adapter="fake-acp", adapter_env="FAKE_ACP_BIN")
    environ = {**os.environ, "FAKE_ACP_BIN": str(tmp_path / "missing")}

    setup = asyncio.run(probe(harness, Path(sys.executable), environ))

    assert setup == Setup(
        "connect", problem="Its ACP adapter isn't set up", adapter="fake-acp"
    )


@pytest.mark.parametrize("module", ["acp_client.probe", "probe"])
def test_the_probe_loads_without_livekit(module: str) -> None:
    # Settings runs the probe each time it checks the agents; LiveKit takes half a second
    # to import and the probe needs none of it.
    loaded = subprocess.run(
        [
            sys.executable,
            "-c",
            f"import sys, {module}; print('livekit' in sys.modules)",
        ],
        cwd=Path(__file__).resolve().parent.parent,
        capture_output=True,
        text=True,
        check=True,
    )
    assert loaded.stdout.strip() == "False"


# Keys by provider, as goose's harness names them: the fake agent's provider setting.
KEYED = dataclasses.replace(
    FAKE,
    pickable_settings=frozenset({"provider"}),
    key_vars=KeyVars(
        setting="provider",
        by_value={
            "p1": (KeyVar("P1_API_KEY", "P1 API key"),),
            "p2": (KeyVar("P2_API_KEY", "P2 API key"),),
            "p3": (KeyVar("P3_API_KEY", "P3 API key"),),
        },
        defaults=frozenset({"default"}),
    ),
)


def started_with(tmp_path: Path) -> list[str]:
    """The key variables the fake agent was started with, by name."""
    lines = (tmp_path / "acp.jsonl").read_text().splitlines()
    return next(e["keys"] for e in map(json.loads, lines) if e["event"] == "initialize")


def test_an_agent_that_names_its_key_variables_over_acp_gets_those_fields(
    tmp_path: Path,
) -> None:
    env = {
        **CAN_DELETE,
        "FAKE_ACP_MODEL": "m1",
        "FAKE_ACP_ENV_VAR_AUTH": "FAKE_API_KEY",
    }

    setup, _ = run_probe(tmp_path, env, KEYED)

    # The protocol's come first; the harness's are only for an agent that names none.
    assert setup.keys == (KeyField("FAKE_API_KEY", "Fake API key"),)


def test_key_fields_follow_the_provider_picked_or_the_agents_own(
    tmp_path: Path,
) -> None:
    env = {**CAN_DELETE, "FAKE_ACP_MODEL": "m1"}

    on_its_own, _ = run_probe(tmp_path, env, KEYED)
    picked, _ = run_probe(tmp_path, env, KEYED, (Pick("provider", "p2"),))
    # Refused for want of the very key the user is about to save: its fields still show.
    refused, _ = run_probe(tmp_path, env, KEYED, (Pick("provider", "p3"),))
    none = dataclasses.replace(KEYED, key_vars=None)
    without, _ = run_probe(tmp_path, env, none)

    assert [k.name for k in on_its_own.keys] == ["P1_API_KEY"]
    assert [k.name for k in picked.keys] == ["P2_API_KEY"]
    # The fake agent refuses p3 as goose refuses a provider without its key.
    assert refused.skipped == (Skipped("provider", "Provider", "p3", "refused"),)
    assert [k.name for k in refused.keys] == ["P3_API_KEY"]
    assert without.keys == ()


def test_a_pick_of_the_agents_own_default_shows_the_provider_it_resolves_to(
    tmp_path: Path,
) -> None:
    env = {**CAN_DELETE, "FAKE_ACP_MODEL": "m1"}

    # "default" isn't a value the fake agent lists, so the session stays on p1.
    setup, _ = run_probe(tmp_path, env, KEYED, (Pick("provider", "default"),))

    assert [k.name for k in setup.keys] == ["P1_API_KEY"]


def test_an_agent_that_refuses_a_session_still_shows_the_keys_it_asks_for(
    tmp_path: Path,
) -> None:
    env = {
        **CAN_DELETE,
        "FAKE_ACP_AUTH_REQUIRED": "1",
        "FAKE_ACP_ENV_VAR_AUTH": "FAKE_API_KEY",
    }
    harness = dataclasses.replace(FAKE, setup_files=("~/.config/fake/config.yaml",))

    setup, _ = run_probe(tmp_path, env, harness)
    by_harness, _ = run_probe(
        tmp_path,
        {**CAN_DELETE, "FAKE_ACP_AUTH_REQUIRED": "1"},
        KEYED,
        (Pick("provider", "p2"),),
    )

    assert setup.step == "sign_in"
    assert setup.keys == (KeyField("FAKE_API_KEY", "Fake API key"),)
    assert setup.setup_files == (str(Path.home() / ".config/fake/config.yaml"),)
    # Without a session, a harness's fields follow the pick.
    assert [k.name for k in by_harness.keys] == ["P2_API_KEY"]


def test_a_saved_key_cut_by_the_length_limit_leaves_no_part_behind(
    tmp_path: Path,
) -> None:
    key = "sk-fake-" + "k" * 40
    # The key starts before the 300-character cut and ends after it.
    message = "x" * 280 + key + " rejected"
    environ = {
        **os.environ,
        **CAN_DELETE,
        "FAKE_ACP_LOG": str(tmp_path / "acp.jsonl"),
        "FAKE_ACP_REFUSE_SESSION": message,
        AGENT_KEYS_ENV: json.dumps({"fake": {"P1_API_KEY": key}}),
    }

    setups = asyncio.run(probe_all({"fake": (KEYED, Path(sys.executable))}, environ))

    problem = setups["fake"].problem or ""
    assert "sk-fake" not in problem
    assert problem.startswith("x" * 280 + "[redacted]")


def test_a_saved_key_an_agent_echoes_never_reaches_the_answer(tmp_path: Path) -> None:
    saved = {"fake": {"P1_API_KEY": "sk-fake-123456"}, "other": {"X": "sk-other-789"}}
    environ = {
        **os.environ,
        **CAN_DELETE,
        "FAKE_ACP_LOG": str(tmp_path / "acp.jsonl"),
        "FAKE_ACP_REFUSE_SESSION": "Credential rejected: sk-fake-123456 (not sk-other-789)",
        AGENT_KEYS_ENV: json.dumps(saved),
    }

    setups = asyncio.run(probe_all({"fake": (KEYED, Path(sys.executable))}, environ))

    answer = json.dumps(dataclasses.asdict(setups["fake"]))
    assert setups["fake"].problem == (
        "Credential rejected: [redacted] (not [redacted])"
    )
    assert "sk-fake" not in answer and "sk-other" not in answer


def test_redaction_touches_only_what_an_agent_says_and_skips_placeholder_keys() -> None:
    setup = Setup(
        "ready",
        problem="Key sk-or-real-123456 rejected",
        fix="goose configure",
        model="goose-model",
        setup_files=("/Users/me/.config/goose/config.yaml",),
        session=True,
    )
    # A dummy key for a local gateway ("goose", "e") is left alone everywhere; a real one
    # goes from the free text only.
    secrets = secrets_to_redact(
        {
            AGENT_KEYS_ENV: json.dumps(
                {"goose": {"A": "goose", "B": "e", "C": "sk-or-real-123456"}}
            )
        }
    )
    assert secrets == ("sk-or-real-123456",)
    redacted = redact(setup, (*secrets, "goose", "e"))
    assert redacted == replace(setup, problem="Key [redacted] rejected")


def test_the_probe_starts_an_agent_with_its_own_saved_keys_only(
    tmp_path: Path,
) -> None:
    saved = {
        "fake": {"P1_API_KEY": "sk-p1"},
        "other": {"OTHER_API_KEY": "sk-other"},
    }
    env = {
        **CAN_DELETE,
        "FAKE_ACP_MODEL": "m1",
        AGENT_KEYS_ENV: json.dumps(saved),
        "OPENAI_API_KEY": "voice",
    }

    _ = run_probe(tmp_path, env, KEYED)

    assert started_with(tmp_path) == ["P1_API_KEY"]


def test_the_setup_files_come_back_with_the_home_folder_expanded(
    tmp_path: Path,
) -> None:
    harness = dataclasses.replace(FAKE, setup_files=("~/.config/fake/config.yaml",))
    env = {**CAN_DELETE, "FAKE_ACP_MODEL": "m1"}

    setup, _ = run_probe(tmp_path, env, harness)
    sessionless, _ = run_probe(tmp_path, {"FAKE_ACP_MODEL": "m1"}, harness)

    expected = (str(Path.home() / ".config/fake/config.yaml"),)
    assert setup.setup_files == expected
    assert sessionless.setup_files == expected
    assert run_probe(tmp_path, env)[0].setup_files == ()


def test_a_probe_that_cant_set_up_fails_its_agent_only(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Its working folder can't be made: a file is in the way.
    blocked = tmp_path / "bomby-probe"
    _ = blocked.write_text("")
    monkeypatch.setattr(probe_module, "FOLDER", blocked)

    setups = asyncio.run(
        probe_all({"fake": (KEYED, Path(sys.executable))}, {**os.environ, **CAN_DELETE})
    )

    assert setups["fake"].step == "unreachable"


def test_metadata_the_probe_cant_read_answers_no_agents() -> None:
    assert probe_cli.main('{"agents": "not a map"}') == "{}"
