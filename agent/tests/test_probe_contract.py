"""The probe's answer, as the app reads it: a real answer with every field set, pinned in
`fixtures/probe-answer.json`, which the core's test reads too (`reads_the_probes_answer` in
app/src-tauri/src/setup.rs). A field added or renamed on one side fails a test until the
other side follows. Regenerate the file with `UPDATE_FIXTURES=1 just agent test`."""

import json
import os
from pathlib import Path

import pytest

import probe as probe_cli
from acp_client.probe import Setup
from acp_client.settings import Option, Setting, Skipped

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "probe-answer.json"

# Every field set, none at its default, so a dropped field shows.
EVERYTHING = Setup(
    step="pick",
    problem="Pick its model",
    fix="goose configure",
    account="Fake Pro",
    model="Kimi K3.1 Pro",
    adapter="codex-acp",
    skipped=(Skipped("provider", "Provider", "p3", "refused"),),
    session=True,
    settings=(
        Setting(
            id="model",
            name="Model",
            category="model",
            current="kimi",
            options=(Option("kimi", "Kimi K3.1 Pro", "Kimi"),),
        ),
    ),
)


def test_the_probes_answer_matches_the_fixture_the_core_reads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_probe_all(*_args: object) -> dict[str, Setup]:
        return {"goose": EVERYTHING}

    monkeypatch.setattr(probe_cli, "probe_all", fake_probe_all)
    answer = json.dumps(json.loads(probe_cli.main("{}")), indent=2) + "\n"

    if os.environ.get("UPDATE_FIXTURES"):
        _ = FIXTURE.write_text(answer)
    assert answer == FIXTURE.read_text(), (
        "the probe's answer changed: run UPDATE_FIXTURES=1 just agent test, then update "
        + "Setup in app/src-tauri/src/setup.rs to match"
    )
