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

from .provider import Tools, Voice, VoiceProvider

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

# Gemini's 30 prebuilt voices: name, style and pitch, as Google lists them for Gemini 3.8
# (ai.google.dev/gemini-api/docs/speech-generation#voices, and AI Studio for the pitch,
# 2026-11-04). Live supports all of them. The larger voice library and custom voices
# (`GET /v1beta/voices`) are left out on purpose.
PREBUILT_VOICES = (
    ("Zephyr", "Bright", "Higher"),
    ("Puck", "Upbeat", "Middle"),
    ("Charon", "Informative", "Lower"),
    ("Kore", "Firm", "Middle"),
    ("Fenrir", "Excitable", "Lower middle"),
    ("Leda", "Youthful", "Higher"),
    ("Orus", "Firm", "Lower middle"),
    ("Aoede", "Breezy", "Middle"),
    ("Callirrhoe", "Easy-going", "Middle"),
    ("Autonoe", "Bright", "Middle"),
    ("Enceladus", "Breathy", "Lower"),
    ("Iapetus", "Clear", "Lower middle"),
    ("Umbriel", "Easy-going", "Lower middle"),
    ("Algieba", "Smooth", "Lower"),
    ("Despina", "Smooth", "Middle"),
    ("Erinome", "Clear", "Middle"),
    ("Algenib", "Gravelly", "Lower"),
    ("Rasalgethi", "Informative", "Middle"),
    ("Laomedeia", "Upbeat", "Higher"),
    ("Achernar", "Soft", "Higher"),
    ("Alnilam", "Firm", "Lower middle"),
    ("Schedar", "Even", "Lower middle"),
    ("Gacrux", "Mature", "Middle"),
    ("Pulcherrima", "Forward", "Middle"),
    ("Achird", "Friendly", "Lower middle"),
    ("Zubenelgenubi", "Casual", "Lower middle"),
    ("Vindemiatrix", "Gentle", "Middle"),
    ("Sadachbia", "Lively", "Lower"),
    ("Sadaltager", "Knowledgeable", "Middle"),
    ("Sulafat", "Warm", "Middle"),
)

# Gemini's own Google Search: it runs on Google's side, so the prompt needn't mention it
# and there's nothing for Bomby to answer (owner, 2026-11-06).
GOOGLE_SEARCH = "google_search"


class Gemini(VoiceProvider):
    id: ClassVar[str] = "gemini"
    name: ClassVar[str] = "Gemini"
    key_env: ClassVar[str] = "GOOGLE_API_KEY"
    # A voice's id is its name, the way the plugin takes it.
    voices: ClassVar[tuple[Voice, ...]] = tuple(
        Voice(name, name, f"{style}, {pitch.lower()} pitch")
        for name, style, pitch in PREBUILT_VOICES
    )
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
