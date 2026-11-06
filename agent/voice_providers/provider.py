"""What sets one voice model (a provider) apart from another: how to reach it, its
voices, the tools it brings and the options the user can switch.

Everything else in a call, from the prompt to `start_task`, memory and the task board, is
the same for every provider.
"""

from abc import ABC, abstractmethod
from collections.abc import Mapping
from typing import ClassVar

from livekit.agents import llm

type Tools = list[llm.Tool | llm.Toolset]


class VoiceProvider(ABC):
    """A speech-to-speech model reached through a LiveKit plugin."""

    id: ClassVar[str]
    """The provider's id in the job's metadata and the app's settings: "gemini". Short,
    lowercase, stable."""
    key_env: ClassVar[str]
    """The variable its plugin reads the user's API key from ("GOOGLE_API_KEY"). The app
    sets it on the worker; it never reaches a coding agent (`acp_client/runner.py`)."""
    default_voice: ClassVar[str]
    """The voice when none is picked; the app defaults to it too (`settings.rs`)."""
    voice_env: ClassVar[str]
    """The voice for console runs, from `agent/.env` ("GEMINI_VOICE")."""
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
