"""What the app sends with a call besides the project (`project.py`, `Project`): the
voice to speak in, what the user likes to be called, the tone they prefer and, when the
user resumes an earlier call, its last lines. How they reach the voice model's instructions is `voice_prompt.py`.

The job's metadata (`job.py`) has `{"voice": "Kore", "user_name": "Sam",
"tone": "chatty", "history": [{"role": "user", "text": "..."}]}`. Console runs have none:
`GEMINI_VOICE`, `BOMBY_USER_NAME` and `BOMBY_TONE` stand in, and there is no history.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

from job import JobFields, Line

# The app defaults to it too (`settings.rs`).
DEFAULT_VOICE = "Leda"

Tone = Literal["sharp", "chatty", "playful"]
TONES: tuple[Tone, ...] = ("sharp", "chatty", "playful")
DEFAULT_TONE: Tone = "sharp"


def tone(value: str) -> Tone:
    # An unknown tone falls back rather than failing the call.
    return value if value in TONES else DEFAULT_TONE


@dataclass(frozen=True)
class CallOptions:
    voice: str
    # Empty when the user hasn't said what to call them.
    user_name: str = ""
    tone: Tone = DEFAULT_TONE
    # Empty when memory across calls is off.
    memory_user: str = ""
    memory_incognito: bool = False
    history: tuple[Line, ...] = ()

    @classmethod
    def from_job(cls, fields: JobFields, environ: Mapping[str, str]) -> "CallOptions":
        fallback = environ.get("GEMINI_VOICE") or DEFAULT_VOICE
        if fields is None:
            return cls(
                voice=fallback,
                user_name=environ.get("BOMBY_USER_NAME", "").strip(),
                tone=tone(environ.get("BOMBY_TONE", "").strip()),
                memory_user=environ.get("BOMBY_MEMORY_USER", "").strip(),
                memory_incognito=environ.get("BOMBY_MEMORY_INCOGNITO") == "1",
            )

        return cls(
            voice=fields.voice or fallback,
            user_name=fields.user_name,
            tone=tone(fields.tone),
            memory_user=fields.memory_user,
            memory_incognito=fields.memory_incognito,
            history=tuple(line for line in fields.history if line.text),
        )

    @property
    def resumed(self) -> bool:
        return bool(self.history)
