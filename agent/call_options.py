"""What the app sends with a call besides the project (`project.py`, `Project`): the
voice model to talk through and its options, the voice to speak in, what the user likes
to be called, the tone they prefer and, when the user resumes an earlier call, its last
lines. How they reach the voice model's instructions is `voice_prompt.py`.

The job's metadata (`job.py`) has `{"provider": "gemini", "provider_options":
{"google_search": true}, "voice": "Kore", "user_name": "Sam", "tone": "chatty",
"history": [{"role": "user", "text": "..."}]}`. Console runs have none: `VOICE_PROVIDER`,
the provider's voice variable (`GEMINI_VOICE`), `BOMBY_USER_NAME` and `BOMBY_TONE` stand
in, and there is no history.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal

from job import JobFields, Line
from voice_providers import GEMINI, VoiceProvider, provider

Tone = Literal["sharp", "chatty", "playful"]
TONES: tuple[Tone, ...] = ("sharp", "chatty", "playful")
DEFAULT_TONE: Tone = "sharp"


def tone(value: str) -> Tone:
    # An unknown tone falls back rather than failing the call.
    return value if value in TONES else DEFAULT_TONE


@dataclass(frozen=True)
class CallOptions:
    voice: str
    provider: VoiceProvider = GEMINI
    # The provider's switches the app sent; `options` adds the defaults.
    provider_options: Mapping[str, bool] = field(default_factory=dict[str, bool])
    # Empty when the user hasn't said what to call them.
    user_name: str = ""
    tone: Tone = DEFAULT_TONE
    # Empty when memory across calls is off.
    memory_user: str = ""
    memory_incognito: bool = False
    history: tuple[Line, ...] = ()

    @classmethod
    def from_job(cls, fields: JobFields, environ: Mapping[str, str]) -> "CallOptions":
        """Raises ValueError for a provider Bomby doesn't have."""
        if fields is None:
            chosen = provider(environ.get("VOICE_PROVIDER", "").strip())
            return cls(
                voice=environ.get(chosen.voice_env) or chosen.default_voice,
                provider=chosen,
                user_name=environ.get("BOMBY_USER_NAME", "").strip(),
                tone=tone(environ.get("BOMBY_TONE", "").strip()),
                memory_user=environ.get("BOMBY_MEMORY_USER", "").strip(),
                memory_incognito=environ.get("BOMBY_MEMORY_INCOGNITO") == "1",
            )

        chosen = provider(fields.provider)
        return cls(
            voice=fields.voice or environ.get(chosen.voice_env) or chosen.default_voice,
            provider=chosen,
            provider_options=dict(fields.provider_options),
            user_name=fields.user_name,
            tone=tone(fields.tone),
            memory_user=fields.memory_user,
            memory_incognito=fields.memory_incognito,
            history=tuple(line for line in fields.history if line.text),
        )

    @property
    def options(self) -> dict[str, bool]:
        """Every option the provider has, as the app set it or by default."""
        return self.provider.resolve(self.provider_options)

    @property
    def resumed(self) -> bool:
        return bool(self.history)
