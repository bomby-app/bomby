import pytest
from livekit.plugins.rime.realtime import RealtimeModel as PrismModel

from tools import ALL_TOOLS
from voice_providers import GEMINI, PROVIDERS, RIME, provider
from voice_providers.gemini import ModelChoice
from voice_providers.rime import TOOL_FILLERS


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
