import asyncio

import pytest
from livekit.plugins.rime.realtime import RealtimeModel as PrismModel

from tools import ALL_TOOLS
from voice_providers import GEMINI, PROVIDERS, RIME, provider, rime
from voice_providers.gemini import ModelChoice
from voice_providers.rime import CONTEXT_MODE, KEEP_ALIVE_LABELS, TOOL_FILLERS


def test_each_provider_has_a_distinct_key_and_voice_variable() -> None:
    assert len({p.key_env for p in PROVIDERS.values()}) == len(PROVIDERS)
    assert len({p.voice_env for p in PROVIDERS.values()}) == len(PROVIDERS)
    assert provider("") is GEMINI
    assert provider("rime") is RIME


def test_rime_talks_through_prism_with_the_users_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("RIME_API_KEY", "a-key")

    model = RIME.realtime_model("aurora", {})

    assert isinstance(model, PrismModel)
    assert model.model == RIME.model == "prism"


def test_rime_takes_history_in_any_order() -> None:
    # A line said over Bomby comes before its cut-off reply; "shared" refuses that, and
    # every update after it, so results never reached Prism.
    assert CONTEXT_MODE == "strict"


def test_rime_brings_no_tools_of_its_own() -> None:
    # Prism takes function tools only; a provider tool like Google Search fails the call.
    assert RIME.tools({}) == []
    assert RIME.options == {}


def test_start_task_has_no_filler_line_on_rime() -> None:
    # Its first update already tells the user the work started.
    assert TOOL_FILLERS["start_task"].type == "none"
    assert {getattr(t, "id", "") for t in ALL_TOOLS} >= set(TOOL_FILLERS)


def test_gemini_reads_its_model_when_the_call_starts() -> None:
    assert ModelChoice.from_env({}).model == "gemini-3.8-live"
    thinking = ModelChoice.from_env({"MODEL": "thinking", "THINKING_LEVEL": "high"})
    assert thinking.model == "gemini-3.8-live-extended-thinking"
    with pytest.raises(ValueError, match="MODEL"):
        _ = ModelChoice.from_env({"MODEL": "slow"})
    with pytest.raises(ValueError, match="THINKING_LEVEL"):
        _ = ModelChoice.from_env({"MODEL": "thinking", "THINKING_LEVEL": "max"})


def test_rime_keeps_a_quiet_call_open(monkeypatch: pytest.MonkeyPatch) -> None:
    # Prism closes a conversation after 5 quiet minutes; Bomby touches its settings sooner.
    assert rime.KEEP_ALIVE_S < 300
    monkeypatch.setenv("RIME_API_KEY", "a-key")
    monkeypatch.setattr(rime, "KEEP_ALIVE_S", 0.01)
    model = RIME.realtime_model("aurora", {})
    sent: list[object] = []

    def update_options(**options: object) -> None:
        sent.append(options)

    monkeypatch.setattr(model, "update_options", update_options)

    async def a_quiet_while() -> None:
        keeping = asyncio.create_task(RIME.keep_alive(model))
        await asyncio.sleep(0.05)
        _ = keeping.cancel()

    asyncio.run(a_quiet_while())

    assert len(sent) >= 2
    assert all(options == {"response_metadata": KEEP_ALIVE_LABELS} for options in sent)


def test_gemini_needs_no_keep_alive() -> None:
    model = GEMINI.realtime_model("Leda", {})
    asyncio.run(asyncio.wait_for(GEMINI.keep_alive(model), 1))
