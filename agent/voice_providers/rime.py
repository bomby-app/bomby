"""Rime's Prism, with the user's Rime key ([notes](../../docs/rime-notes.md)).

Prism hears the audio and speaks in one model, English only. Its replies follow the style
of its instructions, so its prompts (`prompts/rime/`) are plain sentences.
"""

import asyncio
import logging
from collections.abc import Mapping
from typing import ClassVar, override

from livekit.agents import llm
from livekit.plugins.rime.realtime import RealtimeModel, RealtimeSession
from rimelabs_sdk.realtime import PrismFiller

from sections import PLAIN, Style

from .provider import VoiceProvider

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


class DiagnosedModel(RealtimeModel):
    """Prism, logging why it refuses a history update. The plugin logs only
    `Prism history update failed` with a status, and a refused tool result's error is
    lost inside the tool's task (docs/rime-notes.md#the-plugin). Temporary, until the
    cause is known (2026-11-06)."""

    @override
    def session(self, *, turn_detection_disabled: bool = False) -> RealtimeSession:
        session = super().session(turn_detection_disabled=turn_detection_disabled)
        update = session.update_chat_ctx

        async def update_chat_ctx(chat_ctx: llm.ChatContext) -> None:
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
    key_env: ClassVar[str] = "RIME_API_KEY"
    # The owner's pick of Prism's four (aurora, wawona, brando, astra).
    default_voice: ClassVar[str] = "aurora"
    voice_env: ClassVar[str] = "RIME_VOICE"
    prompt_style: ClassVar[Style] = PLAIN

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
