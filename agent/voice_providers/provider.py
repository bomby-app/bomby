"""What sets one voice model (a provider) apart from another: how to reach it, its
voices, the tools it brings and the options the user can set.

Everything else in a call, from the prompt to `start_task`, memory and the task board, is
the same for every provider.
"""

from abc import ABC, abstractmethod
from collections.abc import Mapping
from dataclasses import dataclass, field
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


type OptionValue = bool | str
"""What one option is set to: a switch's on or off, or a choice's value."""


@dataclass(frozen=True)
class Switch:
    """An option that's on or off: Gemini's Google Search."""

    id: str
    default: bool


@dataclass(frozen=True)
class Choice:
    """An option set to one of its values: GPT-Live's response model.

    One can follow another choice, listed before it, whose value decides which of these
    values there are: the response model decides the efforts it has."""

    id: str
    values: tuple[str, ...]
    """Every value, in the order the app lists them; what the plugin takes."""
    default: str
    follows: str = ""
    """The id of the choice this one follows, or empty."""
    per: Mapping[str, tuple[str, ...]] = field(
        default_factory=dict[str, tuple[str, ...]]
    )
    """With `follows`: the values there are for each value of that choice; one it doesn't
    list has them all."""

    def __post_init__(self) -> None:
        # Checked when it's defined, so the app's copy of the rules (`voice.rs`) never
        # meets a choice with nothing to offer.
        if not self.values or self.default not in self.values:
            raise ValueError(f"{self.id}: the default must be one of its values")
        if self.per and not self.follows:
            raise ValueError(f"{self.id}: values per leader need a choice to follow")
        for leader, values in self.per.items():
            if not values or not set(values) <= set(self.values):
                raise ValueError(
                    f"{self.id}: the values for {leader} must be some of its own"
                )

    def offered(self, leader: OptionValue | None) -> tuple[str, ...]:
        """The values there are when the choice this one follows is `leader`."""
        if not self.follows or not isinstance(leader, str):
            return self.values
        return self.per.get(leader, self.values)

    def default_in(self, offered: tuple[str, ...]) -> str:
        """The default when it's offered, else the first value that is."""
        return self.default if self.default in offered else offered[0]


type Option = Switch | Choice


def check_options(provider: str, options: tuple[Option, ...]) -> None:
    """Each option's id is its own, and a choice follows one listed before it."""
    seen: dict[str, Option] = {}
    for option in options:
        if option.id in seen:
            raise ValueError(f"{provider}: {option.id} is listed twice")
        if isinstance(option, Choice) and option.follows:
            leader = seen.get(option.follows)
            if not isinstance(leader, Choice):
                raise ValueError(
                    f"{provider}: {option.id} follows {option.follows}, which isn't a "
                    + "choice listed before it"
                )
            if not set(option.per) <= set(leader.values):
                raise ValueError(
                    f"{provider}: {option.id} lists values for ones {option.follows} lacks"
                )
        seen[option.id] = option


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
    delegates: ClassVar[bool] = False
    """Whether a second model, the backend, reasons and calls the tools, with its own
    instructions (GPT-Live's response model), so the voice model never sees the tools.
    Gemini and Prism do both themselves and get none."""
    late_result_chars: ClassVar[int | None] = None
    """Most characters a late `start_task` result may take, its task included; `None` for no limit."""
    backend_style: ClassVar[Style] = MARKDOWN
    """With `delegates`, how the backend's instructions are written
    (`prompts/<id>/backend.md` and what each call adds)."""
    options: ClassVar[tuple[Option, ...]] = ()
    """What the user can set for this provider, in the order Settings shows them: Gemini's
    Google Search switch. The app sends the ones it has."""

    def __init_subclass__(cls) -> None:
        super().__init_subclass__()
        check_options(cls.__name__, cls.options)

    def recall_hint(self, style: Style) -> str:
        """How the memory note in the prompt says to look up the rest: with the recall tool
        for a model that calls its tools itself."""
        return f"look up anything else with {style.code('recall_about_user')}"

    @property
    @abstractmethod
    def model(self) -> str:
        """The model a call talks to, for the logs ("gemini-3.8-live")."""

    @abstractmethod
    def realtime_model(
        self, voice: str, options: Mapping[str, OptionValue], backend: str
    ) -> llm.RealtimeModel | llm.DuplexModel:
        """A new model for one call's session, speaking in `voice`. `backend` is the
        backend's instructions for a provider that `delegates`, and empty for any other."""

    async def keep_alive(self, model: llm.RealtimeModel | llm.DuplexModel) -> None:
        """Runs for the whole call beside the session, for a provider that closes a quiet
        conversation on its own. Gemini's needs nothing."""
        del model

    def tools(self, options: Mapping[str, OptionValue]) -> Tools:
        """The provider's own tools for a call, beside Bomby's (`tools/`)."""
        del options
        return []

    def resolve(self, given: Mapping[str, OptionValue]) -> dict[str, OptionValue]:
        """Every option this provider has: the value the app sent, else its default.
        Options it doesn't have are ignored, like unknown metadata fields, and so is a
        choice's value it doesn't offer (a model since retired); a value of the wrong kind
        raises ValueError, which fails the call at start like any invalid metadata."""
        resolved: dict[str, OptionValue] = {}
        for option in self.options:
            value = given.get(option.id)
            match option:
                case Switch():
                    if value is not None and not isinstance(value, bool):
                        raise ValueError(f"{self.name}'s {option.id} is on or off.")
                    resolved[option.id] = option.default if value is None else value
                case Choice():
                    if value is not None and not isinstance(value, str):
                        raise ValueError(
                            f"{self.name}'s {option.id} is one of its values."
                        )
                    offered = option.offered(resolved.get(option.follows))
                    resolved[option.id] = (
                        value
                        if isinstance(value, str) and value in offered
                        else option.default_in(offered)
                    )
        return resolved
