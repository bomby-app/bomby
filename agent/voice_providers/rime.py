"""Rime's Prism, with the user's Rime key ([notes](../../docs/rime-notes.md)).

Prism hears the audio and speaks in one model, English only. Its replies follow the style
of its instructions, so its prompts (`prompts/rime/`) are plain sentences.
"""

import asyncio
import logging
from collections.abc import Mapping
from itertools import pairwise
from typing import ClassVar, override

from livekit.agents import llm
from livekit.plugins.rime.realtime import RealtimeModel, RealtimeSession
from livekit.plugins.rime.realtime import realtime_model as plugin
from rimelabs_sdk.realtime import PrismFiller

from sections import PLAIN, Style

from .provider import Voice, VoiceProvider

logger = logging.getLogger("bomby.rime")

# Prism says a short line of its own before a tool runs. `start_task` gets none: its first
# update already tells the user the work started (`tools/start_task.py`).
TOOL_FILLERS = {"start_task": PrismFiller(type="none")}

# Prism closes a conversation after 5 minutes without a client event, even while audio
# streams, and doesn't resume it; a quiet wait on a long task would end the call. Setting
# the labels later replies carry is a client event that changes nothing else
# (docs.rime.ai/docs/prism/errors#limits, `update_options` in the plugin, 1.8.11).
KEEP_ALIVE_S = 240.0
KEEP_ALIVE_LABELS = {"app": "bomby"}


# How many of the latest history items a refusal logs.
RECENT = 12


def _describe(item: llm.ChatItem) -> tuple[str, str, str, float]:
    """An item for the log: its id's end, its kind, a few words, and when it was made."""
    kind = item.type
    words = ""
    if isinstance(item, llm.ChatMessage):
        kind = f"{item.role}{' (interrupted)' if item.interrupted else ''}"
        words = (item.text_content or "")[:40]
    elif isinstance(item, (llm.FunctionCall, llm.FunctionCallOutput)):
        words = item.call_id[-12:]
    return (item.id[-8:], kind, words, round(item.created_at, 2))


def in_prism_order(target: llm.ChatContext, record: llm.ChatContext) -> llm.ChatContext:
    """LiveKit's update with the items Prism already has in Prism's own order, then the
    new ones in LiveKit's; `target` itself when the two orders already agree.

    The plugin (1.8.11) records a reply's text when the reply ends, after its tool call,
    while LiveKit dates the text from when speech started, before the call. Shared mode
    then refuses every later update, though it keeps its own order for the items it has
    anyway (`_shared_target` in `realtime/_history.py`). Workaround until the plugin
    fixes it (docs/rime-notes.md#the-plugin)."""
    positions = {item.id: index for index, item in enumerate(record.items)}
    # Configuration records never reach Prism, so they don't count either way.
    items = [
        i
        for i in target.items
        if i.type in ("message", "function_call", "function_call_output")
    ]
    known = [i for i in items if i.id in positions]
    in_order = all(positions[a.id] < positions[b.id] for a, b in pairwise(known))
    first_new = next(
        (n for n, i in enumerate(items) if i.id not in positions), len(items)
    )
    if in_order and all(i.id not in positions for i in items[first_new:]):
        return target
    ordered = sorted(
        (i for i in target.items if i.id in positions), key=lambda i: positions[i.id]
    )
    return llm.ChatContext(
        [*ordered, *(i for i in target.items if i.id not in positions)]
    )


class DiagnosedModel(RealtimeModel):
    """Prism, with LiveKit's history updates put in Prism's order (`in_prism_order`) and
    logging why it still refuses one. The plugin logs only `Prism history update
    failed` with a status, and a refused tool result's error is lost inside the tool's
    task (docs/rime-notes.md#the-plugin). Until the plugin is fixed (2026-11-06)."""

    @override
    def session(self, *, turn_detection_disabled: bool = False) -> RealtimeSession:
        session = super().session(turn_detection_disabled=turn_detection_disabled)
        update = session.update_chat_ctx

        async def update_chat_ctx(target: llm.ChatContext) -> None:
            # Ordinary updates only: an explicit history edit is checked against its own
            # target, so it passes as is (the plugin's private `_edit` marker, 1.8.11).
            editing = getattr(plugin, "_edit").get() is not None  # noqa: B009
            # The plugin's record, as its public copy, read just before the update.
            chat_ctx = target if editing else in_prism_order(target, session.chat_ctx)
            try:
                await update(chat_ctx)
            except Exception as error:
                # The plugin's own record of Prism's history, read for diagnosis only.
                record = getattr(getattr(session, "_history", None), "_chat", None)
                known: list[llm.ChatItem] = list(getattr(record, "items", []))
                positions = {item.id: index for index, item in enumerate(known)}
                logger.warning(
                    "Prism refused a history update: %s: %s",
                    type(error).__name__,
                    error,
                    extra={
                        "status": getattr(error, "status", None),
                        "recoverable": getattr(error, "recoverable", None),
                        # What LiveKit sent, each with its place in the plugin's record
                        # (None: the plugin has never seen it).
                        "sent": [
                            (*_describe(item), positions.get(item.id))
                            for item in chat_ctx.items[-RECENT:]
                        ],
                        "plugin_record": [_describe(item) for item in known[-RECENT:]],
                    },
                )
                raise

        setattr(session, "update_chat_ctx", update_chat_ctx)  # noqa: B010
        return session


class Rime(VoiceProvider):
    id: ClassVar[str] = "rime"
    name: ClassVar[str] = "Rime"
    key_env: ClassVar[str] = "RIME_API_KEY"
    # Prism's four voices, its own rather than Rime's TTS voices: how each sounds,
    # shortened from docs.rime.ai/docs/prism/sessions#choose-a-voice (2026-11-06).
    voices: ClassVar[tuple[Voice, ...]] = (
        Voice("aurora", "Aurora", "Calm and casual, lower pitch"),
        Voice("wawona", "Wawona", "Bright and polished, higher pitch"),
        Voice("brando", "Brando", "Low and steady, confident"),
        Voice("astra", "Astra", "Clear and youthful, energetic"),
    )
    # The owner's pick of the four.
    default_voice: ClassVar[str] = "aurora"
    voice_env: ClassVar[str] = "RIME_VOICE"
    prompt_style: ClassVar[Style] = PLAIN
    # Prism doesn't deduplicate tool calls (docs/rime-notes.md#the-plugin).
    repeats_tool_calls: ClassVar[bool] = True

    @property
    @override
    def model(self) -> str:
        return "prism"

    @override
    def realtime_model(
        self, voice: str, options: Mapping[str, bool]
    ) -> llm.RealtimeModel:
        # Playback is Prism's own estimate of what the user heard: the plugin measures it
        # only with its audio output wrapper, which 1.8.11 keeps private.
        return DiagnosedModel(
            voice=voice,
            tool_fillers=TOOL_FILLERS,
            response_metadata=KEEP_ALIVE_LABELS,
        )

    @override
    async def keep_alive(self, model: llm.RealtimeModel) -> None:
        if not isinstance(model, RealtimeModel):
            return
        while True:
            await asyncio.sleep(KEEP_ALIVE_S)
            model.update_options(response_metadata=KEEP_ALIVE_LABELS)


RIME = Rime()
