"""What the app sends with a call besides the project (`project.py`, `Project`): the
voice to speak in and, when the user resumes an earlier call, its last lines.

Metadata is the job's JSON, `{"voice": "Kore", "history": [{"role": "user", "text": "..."}]}`
(`app/src-tauri/src/calls.rs`, `dispatch_metadata`). Console runs have none: `GEMINI_VOICE`
stands in for the voice, and there is no history.
"""

import json
import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal, cast

# The voice the agent has always had; the app defaults to it too (`settings.rs`).
DEFAULT_VOICE = "Charon"

Speaker = Literal["user", "agent"]
SPEAKER_LABEL: dict[Speaker, str] = {"user": "User", "agent": "You"}


@dataclass(frozen=True)
class Line:
    speaker: Speaker
    text: str


@dataclass(frozen=True)
class CallOptions:
    voice: str
    history: tuple[Line, ...] = ()

    @classmethod
    def from_job(cls, metadata: str, environ: Mapping[str, str]) -> "CallOptions":
        fallback = environ.get("GEMINI_VOICE") or DEFAULT_VOICE
        if not metadata.strip():
            return cls(voice=fallback)
        data = cast(object, json.loads(metadata))
        fields = cast(dict[str, object], data) if isinstance(data, dict) else None
        if fields is None:
            raise ValueError("job metadata must be a JSON object")

        voice = fields.get("voice")
        if voice is not None and (not isinstance(voice, str) or not voice.strip()):
            raise ValueError("the voice must be a voice name")

        raw: object = fields.get("history") or []
        items = cast(list[object], raw) if isinstance(raw, list) else None
        if items is None:
            raise ValueError("history must be a list of lines")
        history: list[Line] = []
        for item in items:
            entry = cast(dict[str, object], item) if isinstance(item, dict) else {}
            role, text = entry.get("role"), entry.get("text")
            if role not in SPEAKER_LABEL or not isinstance(text, str):
                raise ValueError(f"not a history line: {item!r}")
            if text.strip():
                history.append(Line(role, text.strip()))

        return cls(voice=voice.strip() if voice else fallback, history=tuple(history))

    @property
    def resumed(self) -> bool:
        return bool(self.history)

    def instructions(self, base: str) -> str:
        """`base`, plus the earlier conversation when this call resumes one."""
        if not self.history:
            return base
        lines = "\n".join(f"{SPEAKER_LABEL[l.speaker]}: {l.text}" for l in self.history)
        return (
            f"{base}\n\n## Previous conversation\n\n"
            "You're picking up an earlier conversation with the user; its last lines are "
            "below. Carry on as if it never stopped. Claude doesn't remember it, though "
            "anything Claude did then is still done, so when you hand off a follow-up, tell "
            "Claude what it needs to know.\n\n"
            f"{lines}"
        )


def call_options(metadata: str) -> CallOptions:
    return CallOptions.from_job(metadata, os.environ)
