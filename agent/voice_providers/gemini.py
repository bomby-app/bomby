"""Gemini Live, with the user's Google AI Studio key ([notes](../../docs/gemini-notes.md)).

`MODEL` picks the model for runs from source: "fast" (the default) or "thinking", with
`THINKING_LEVEL` for the second.
"""

import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import ClassVar, override

from google.genai import types
from livekit.agents import NOT_GIVEN, llm
from livekit.agents.types import NotGiven
from livekit.plugins import google
from livekit.plugins.google.tools import GoogleSearch

from .provider import Tools, VoiceProvider

MODELS = {
    "fast": "gemini-3.8-live",
    "thinking": "gemini-3.8-live-extended-thinking",
}
THINKING_LEVELS = ("low", "medium", "high")


@dataclass(frozen=True)
class ModelChoice:
    """The model and its thinking level, from `MODEL` and `THINKING_LEVEL`. Read when a
    call starts rather than on import, so `agent/.env` (loaded after imports) counts."""

    model: str
    thinking: types.ThinkingConfig | NotGiven

    @classmethod
    def from_env(cls, environ: Mapping[str, str]) -> "ModelChoice":
        key = environ.get("MODEL", "fast")
        if key not in MODELS:
            raise ValueError(f"MODEL must be one of {sorted(MODELS)}, got {key!r}")
        level = environ.get("THINKING_LEVEL", "low")
        if level not in THINKING_LEVELS:
            raise ValueError(
                f"THINKING_LEVEL must be one of {THINKING_LEVELS}, got {level!r}"
            )
        # Extended Thinking requires a thinking level; the server closes the session with
        # 1007 without one. gemini-3.8-live rejects one, so it's sent only for "thinking".
        thinking = (
            types.ThinkingConfig(thinking_level=types.ThinkingLevel(level.upper()))
            if key == "thinking"
            else NOT_GIVEN
        )
        return cls(MODELS[key], thinking)


# The language the user speaks. Gemini's native-audio models pick their spoken language
# themselves (no language code), so the prompt holds them to it; the transcription takes a
# hint, which stops noise being written down as Portuguese or Russian (2026-11-04).
LANGUAGE_CODES = ["en-US"]

# Gemini's own Google Search: it runs on Google's side, so the prompt needn't mention it
# and there's nothing for Bomby to answer (owner, 2026-11-06).
GOOGLE_SEARCH = "google_search"


class Gemini(VoiceProvider):
    id: ClassVar[str] = "gemini"
    key_env: ClassVar[str] = "GOOGLE_API_KEY"
    default_voice: ClassVar[str] = "Leda"
    voice_env: ClassVar[str] = "GEMINI_VOICE"
    options: ClassVar[Mapping[str, bool]] = {GOOGLE_SEARCH: True}

    @property
    @override
    def model(self) -> str:
        return ModelChoice.from_env(os.environ).model

    @override
    def realtime_model(
        self, voice: str, options: Mapping[str, bool]
    ) -> llm.RealtimeModel:
        # Everything Gemini gets at connect time is final for the session. The plugin
        # reconnects on a tool change and can only inject later instructions as a turn.
        choice = ModelChoice.from_env(os.environ)
        return google.realtime.RealtimeModel(
            model=choice.model,
            voice=voice,
            input_audio_transcription=types.AudioTranscriptionConfig(
                language_codes=LANGUAGE_CODES
            ),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            thinking_config=choice.thinking,
        )

    @override
    def tools(self, options: Mapping[str, bool]) -> Tools:
        return [GoogleSearch()] if options.get(GOOGLE_SEARCH) else []


GEMINI = Gemini()
