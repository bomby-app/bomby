import asyncio
import json
from collections.abc import Callable
from pathlib import Path
from typing import cast

import pytest
from livekit.agents import llm
from livekit.plugins.rime.realtime import PrismHistoryUpdateError
from livekit.plugins.rime.realtime import RealtimeModel as PrismModel

from tools import ALL_TOOLS
from voice_providers import GEMINI, PROVIDERS, RIME, catalogue, provider, rime
from voice_providers.gemini import ModelChoice
from voice_providers.rime import KEEP_ALIVE_LABELS, TOOL_FILLERS, in_prism_order


def test_each_provider_has_a_distinct_key_and_voice_variable() -> None:
    assert len({p.key_env for p in PROVIDERS.values()}) == len(PROVIDERS)
    assert len({p.voice_env for p in PROVIDERS.values()}) == len(PROVIDERS)
    assert provider("") is GEMINI
    assert provider("rime") is RIME


def test_each_provider_defaults_to_one_of_its_own_voices() -> None:
    for p in PROVIDERS.values():
        ids = [v.id for v in p.voices]
        assert len(set(ids)) == len(ids)
        assert p.default_voice in ids
    assert len(GEMINI.voices) == 30
    kore = next(v for v in GEMINI.voices if v.id == "Kore")
    assert (kore.name, kore.description) == ("Kore", "Firm, middle pitch")
    assert [v.id for v in RIME.voices] == ["aurora", "wawona", "brando", "astra"]


def test_the_apps_catalogue_lists_every_provider_in_order(tmp_path: Path) -> None:
    written = cast(dict[str, list[dict[str, object]]], json.loads(catalogue.render()))
    gemini, rime_entry = written["providers"]
    assert [gemini["id"], rime_entry["id"]] == list(PROVIDERS)
    assert gemini["key_env"] == "GOOGLE_API_KEY"
    assert gemini["default_voice"] == "Leda"
    assert gemini["options"] == [{"id": "google_search", "default": True}]
    assert rime_entry["options"] == []

    path = str(tmp_path / "voice-providers.json")
    assert catalogue.main(["check", path]) == 1
    assert catalogue.main(["write", path]) == 0
    assert catalogue.main(["check", path]) == 0


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


def items() -> dict[str, llm.ChatItem]:
    """A reply that spoke, then called start_task; its first result; the final one."""
    return {
        "user": llm.ChatMessage(id="user", role="user", content=["add a readme"]),
        "said": llm.ChatMessage(id="said", role="assistant", content=["On it."]),
        "call": llm.FunctionCall(
            id="call", call_id="c1", name="start_task", arguments="{}"
        ),
        "first": llm.FunctionCallOutput(
            id="first",
            call_id="c1",
            name="start_task",
            output="started",
            is_error=False,
        ),
        "final_call": llm.FunctionCall(
            id="final_call", call_id="c1_final", name="start_task", arguments="{}"
        ),
        "final": llm.FunctionCallOutput(
            id="final",
            call_id="c1_final",
            name="start_task",
            output="done",
            is_error=False,
        ),
    }


def context(found: dict[str, llm.ChatItem], *ids: str) -> llm.ChatContext:
    return llm.ChatContext([found[i] for i in ids])


def test_prisms_own_order_passes_the_plugins_check() -> None:
    from livekit.plugins.rime.realtime._history import PrismHistory

    found = items()
    # The plugin records the call when it arrives and the text when the reply ends;
    # LiveKit dates the text from when speech started, before the call.
    plugin = context(found, "user", "call", "said", "first")
    livekit = context(found, "user", "said", "call", "first", "final_call", "final")
    history = PrismHistory(cast(object, None))  # pyright: ignore[reportArgumentType]
    history._chat = plugin  # pyright: ignore[reportPrivateUsage]
    check = cast(
        Callable[[llm.ChatContext], llm.ChatContext],
        history._shared_target,  # pyright: ignore[reportPrivateUsage]
    )

    with pytest.raises(PrismHistoryUpdateError, match="append order"):
        _ = check(livekit)
    accepted = check(in_prism_order(livekit, plugin))
    assert [i.id for i in accepted.items] == [
        "user",
        "call",
        "said",
        "first",
        "final_call",
        "final",
    ]


def test_an_update_already_in_prisms_order_is_passed_on_as_is() -> None:
    found = items()
    plugin = context(found, "user", "call", "said", "first")
    update = context(found, "user", "call", "said", "first", "final_call", "final")
    assert in_prism_order(update, plugin) is update


def test_the_session_reorders_ordinary_updates_and_leaves_explicit_edits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from livekit.plugins.rime.realtime import RealtimeSession
    from livekit.plugins.rime.realtime import realtime_model as plugin

    found = items()
    record = context(found, "user", "call", "said", "first")
    livekit = context(found, "user", "said", "call", "first", "final_call", "final")
    passed: list[list[str]] = []

    async def plugin_update(_self: object, chat_ctx: llm.ChatContext) -> None:
        passed.append([i.id for i in chat_ctx.items])

    monkeypatch.setenv("RIME_API_KEY", "a-key")
    monkeypatch.setattr(RealtimeSession, "update_chat_ctx", plugin_update)
    monkeypatch.setattr(RealtimeSession, "chat_ctx", property(lambda _self: record))

    async def scenario() -> None:
        model = cast(PrismModel, RIME.realtime_model("aurora", {}))
        session: RealtimeSession = model.session()
        await session.update_chat_ctx(livekit)
        edit = getattr(plugin, "_edit").set(object())  # noqa: B009
        try:
            await session.update_chat_ctx(livekit)
        finally:
            getattr(plugin, "_edit").reset(edit)  # noqa: B009
        await session.aclose()
        await model.aclose()

    asyncio.run(scenario())

    assert passed == [
        ["user", "call", "said", "first", "final_call", "final"],
        ["user", "said", "call", "first", "final_call", "final"],
    ]
