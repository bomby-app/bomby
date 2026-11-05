"""What the app sends with a call besides the project (`project.py`, `Project`): the
voice to speak in, what the user likes to be called and, when the user resumes an earlier
call, its last lines. How they reach the voice model's instructions is `voice_prompt.py`.

The job's metadata (`job.py`) has `{"voice": "Kore", "user_name": "Sam",
"history": [{"role": "user", "text": "..."}]}`. Console runs have none: `GEMINI_VOICE`
and `BOMBY_USER_NAME` stand in, and there is no history.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal, cast, get_args

from job import JobFields

# The voice the agent has always had; the app defaults to it too (`settings.rs`).
DEFAULT_VOICE = "Charon"

Speaker = Literal["user", "agent"]
SPEAKERS: tuple[Speaker, ...] = get_args(Speaker)


@dataclass(frozen=True)
class Line:
    speaker: Speaker
    text: str


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

        voice = fields.get("voice")
        if voice is not None and (not isinstance(voice, str) or not voice.strip()):
            raise ValueError("the voice must be a voice name")

        user_name = fields.get("user_name")
        if user_name is not None and not isinstance(user_name, str):
            raise ValueError("the user's name must be text")

        raw: object = fields.get("history") or []
        items = cast(list[object], raw) if isinstance(raw, list) else None
        if items is None:
            raise ValueError("history must be a list of lines")
        history: list[Line] = []
        for item in items:
            entry = cast(dict[str, object], item) if isinstance(item, dict) else {}
            role, text = entry.get("role"), entry.get("text")
            if role not in SPEAKERS or not isinstance(text, str):
                raise ValueError(f"not a history line: {item!r}")
            if text.strip():
                history.append(Line(role, text.strip()))

        return cls(
            voice=voice.strip() if voice else fallback,
            user_name=user_name.strip() if user_name else "",
            history=tuple(history),
        )

    @property
    def resumed(self) -> bool:
        return bool(self.history)
