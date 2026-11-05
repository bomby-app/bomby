"""What the app sends with a call besides the project (`project.py`, `Project`): the
voice to speak in, what the user likes to be called and, when the user resumes an earlier
call, its last lines. How they reach the voice model's instructions is `voice_prompt.py`.

The job's metadata (`job.py`) has `{"voice": "Kore", "user_name": "Sam",
"history": [{"role": "user", "text": "..."}]}`. Console runs have none: `GEMINI_VOICE`
and `BOMBY_USER_NAME` stand in, and there is no history.
"""

from collections.abc import Mapping
from dataclasses import dataclass

from job import JobFields, Line

# The voice the agent has always had; the app defaults to it too (`settings.rs`).
DEFAULT_VOICE = "Charon"


@dataclass(frozen=True)
class CallOptions:
    voice: str
    # Empty when the user hasn't said what to call them.
    user_name: str = ""
    history: tuple[Line, ...] = ()

    @classmethod
    def from_job(cls, fields: JobFields, environ: Mapping[str, str]) -> "CallOptions":
        fallback = environ.get("GEMINI_VOICE") or DEFAULT_VOICE
        if fields is None:
            return cls(
                voice=fallback, user_name=environ.get("BOMBY_USER_NAME", "").strip()
            )

        return cls(
            voice=fields.voice or fallback,
            user_name=fields.user_name,
            history=tuple(line for line in fields.history if line.text),
        )

    @property
    def resumed(self) -> bool:
        return bool(self.history)
