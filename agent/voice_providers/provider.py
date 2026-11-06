"""What sets one voice model (a provider) apart from another: how to reach it, its
voices, the tools it brings and the options the user can switch.

Everything else in a call, from the prompt to `start_task`, memory and the task board, is
the same for every provider.
"""

from abc import ABC, abstractmethod
from collections.abc import Mapping
from dataclasses import dataclass
from typing import ClassVar

from livekit.agents import llm

from sections import MARKDOWN, Style

type Tools = list[llm.Tool | llm.Toolset]


@dataclass(frozen=True)
class Voice:
    """One of a provider's voices, as Settings, Voice lists it."""

    id: str
    """What its plugin takes, and the app saves and sends as `voice`: "Kore", "aurora"."""
    name: str
    description: str
    """How it sounds: "Firm, middle pitch"."""


class VoiceProvider(ABC):
    """A speech-to-speech model reached through a LiveKit plugin."""

    id: ClassVar[str]
    """The provider's id in the job's metadata and the app's settings: "gemini". Short,
    lowercase, stable."""
    name: ClassVar[str]
    """How the app talks about it: "Gemini"."""
    key_env: ClassVar[str]
    """The variable its plugin reads the user's API key from ("GOOGLE_API_KEY"). The app
    sets it on the worker; it never reaches a coding agent (`acp_client/runner.py`)."""
    voices: ClassVar[tuple[Voice, ...]]
    """The voices the user can pick from in the app, in the order it lists them."""
    default_voice: ClassVar[str]
    """The voice when none is picked, one of `voices`; the app defaults to it too."""
    voice_env: ClassVar[str]
    """The voice for console runs, from `agent/.env` ("GEMINI_VOICE")."""
    prompt_style: ClassVar[Style] = MARKDOWN
    """How its prompts are written: its tone prompts in `prompts/<id>/` and the sections
    each call adds (`voice_prompt.py`)."""
    repeats_tool_calls: ClassVar[bool] = False
    """Whether the model can call a tool twice for one request, so `start_task` answers a
    repeat instead of sending it again. Prism can; Gemini doesn't, and never gets the
    check."""
    options: ClassVar[Mapping[str, bool]] = {}
    """The switches the user can flip for this provider, by id, with their defaults:
    Gemini's {"google_search": True}. The app sends the ones it has."""

    @property
    @abstractmethod
    def model(self) -> str:
        """The model a call talks to, for the logs ("gemini-3.8-live")."""

    @abstractmethod
    def realtime_model(
        self, voice: str, options: Mapping[str, bool]
    ) -> llm.RealtimeModel:
        """A new model for one call's session, speaking in `voice`."""

    async def keep_alive(self, model: llm.RealtimeModel) -> None:
        """Runs for the whole call beside the session, for a provider that closes a quiet
        conversation on its own. Gemini's needs nothing."""
        del model

    def tools(self, options: Mapping[str, bool]) -> Tools:
        """The provider's own tools for a call, beside Bomby's (`tools/`)."""
        del options
        return []

    def resolve(self, given: Mapping[str, bool]) -> dict[str, bool]:
        """Every option this provider has: the value the app sent, else its default.
        Options it doesn't have are ignored, like unknown metadata fields."""
        return {
            name: given.get(name, default) for name, default in self.options.items()
        }
