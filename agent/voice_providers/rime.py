"""Rime's Prism, with the user's Rime key ([notes](../../docs/rime-notes.md)).

Prism hears the audio and speaks in one model, English only. Its replies follow the style
of its instructions, so its prompts (`prompts/rime/`) are plain sentences.
"""

import asyncio
from collections.abc import Mapping
from typing import ClassVar, override

from livekit.agents import llm
from livekit.plugins.rime.realtime import RealtimeModel
from rimelabs_sdk.realtime import PrismFiller

from sections import PLAIN, Style

from .provider import VoiceProvider

# Prism says a short line of its own before a tool runs. `start_task` gets none: its first
# update already tells the user the work started (`tools/start_task.py`).
TOOL_FILLERS = {"start_task": PrismFiller(type="none")}

# Prism closes a conversation after 5 minutes without a client event, even while audio
# streams, and doesn't resume it; a quiet wait on a long task would end the call. Setting
# the labels later replies carry is a client event that changes nothing else
# (docs.rime.ai/docs/prism/errors#limits, `update_options` in the plugin, 1.8.11).
KEEP_ALIVE_S = 240.0
KEEP_ALIVE_LABELS = {"app": "bomby"}


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
        return RealtimeModel(
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
