"""OpenAI's GPT-Live, with the user's OpenAI key ([notes](../../docs/openai-notes.md)).

GPT-Live talks and listens at once, and hands the reasoning and every tool call to a second
model, its response model (the backend), which has instructions of its own
(`prompts/openai/backend.md`). The user picks the response model and its reasoning effort.
"""

from collections.abc import Mapping
from typing import ClassVar, Literal, cast, override

from livekit.agents import llm
from livekit.plugins.openai.realtime import GPTLiveModel, ResponsesDelegationOptions
from livekit.plugins.openai.tools import WebSearch

from sections import PLAIN, Style

from .provider import Choice, Option, OptionValue, Switch, Tools, Voice, VoiceProvider

# GPT-Live's natural voices, in the order OpenAI lists them, with how each sounds and its
# language or accent (developers.openai.com/api/docs/guides/live-conversations#voice-options
# and the OpenAI playground, 2026-11-07). The generated voices are left out (owner).
NATURAL_VOICES = (
    ("gleam", "Gleam", "Warm and conversational", "North American"),
    ("ripple", "Ripple", "Warm and conversational", "Australian"),
    ("vesper", "Vesper", "Clear and direct", "British"),
    ("willow", "Willow", "Expressive and bright", "Irish"),
    ("stone", "Stone", "Calm and precise", "Irish"),
    ("meridian", "Meridian", "Grounded and measured", "North American"),
    ("bossa", "Bossa", "Clear and direct", "Brazilian Portuguese"),
    ("tempo", "Tempo", "Grounded and measured", "Brazilian Portuguese"),
    ("cedar", "Cedar", "Open and upbeat", "North American"),
    ("marin", "Marin", "Animated and earnest", "North American"),
    ("nuri", "Nuri", "Warm and animated", "German"),
    ("juni", "Juni", "Bright and expressive", "German"),
    ("flitz", "Flitz", "Rich and playful", "German"),
    ("brise", "Brise", "Clear and conversational", "French"),
    ("sillage", "Sillage", "Warm and grounded", "French"),
    ("nira", "Nira", "Soft and thoughtful", "Hindi"),
    ("harema", "Harema", "Gentle and engaging", "Japanese"),
    ("shida", "Shida", "Quiet and grounded", "Japanese"),
    ("noeul", "Noeul", "Airy and expressive", "Korean"),
)

WEB_SEARCH = "web_search"
RESPONSE_MODEL = "response_model"
EFFORT = "reasoning_effort"

# The response models, GPT-6 and 6.1 only (owner, 2026-11-07), and the efforts each takes
# (each model's page under developers.openai.com/api/docs/models, 2026-11-07). They also
# take `max`, left out to stay safe (owner).
RESPONSE_MODELS = ("gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna")
EFFORTS = ("none", "low", "medium", "high", "xhigh")
WITHOUT_NONE = ("low", "medium", "high", "xhigh")

type Effort = Literal["none", "low", "medium", "high", "xhigh"]


class OpenAI(VoiceProvider):
    id: ClassVar[str] = "openai"
    name: ClassVar[str] = "OpenAI"
    key_env: ClassVar[str] = "OPENAI_API_KEY"
    voices: ClassVar[tuple[Voice, ...]] = tuple(
        Voice(id, name, f"{style}, {accent}")
        for id, name, style, accent in NATURAL_VOICES
    )
    # The owner's pick.
    default_voice: ClassVar[str] = "gleam"
    voice_env: ClassVar[str] = "OPENAI_VOICE"
    # GPT-Live's own prompt guide writes plain labelled paragraphs; the call's sections
    # follow suit.
    prompt_style: ClassVar[Style] = PLAIN
    delegates: ClassVar[bool] = True
    # GPT-Live refuses an append over 500 tokens; ~4 characters a token, with room to spare.
    late_result_chars: ClassVar[int | None] = 1_600
    options: ClassVar[tuple[Option, ...]] = (
        # OpenAI's web search, run on the response model's side.
        Switch(WEB_SEARCH, default=True),
        Choice(RESPONSE_MODEL, values=RESPONSE_MODELS, default="gpt-6-luna"),
        Choice(
            EFFORT,
            values=EFFORTS,
            default="medium",
            follows=RESPONSE_MODEL,
            per={"gpt-6-astra": WITHOUT_NONE, "gpt-6.1-sol": WITHOUT_NONE},
        ),
    )

    @override
    def recall_hint(self, style: Style) -> str:
        # GPT-Live can't call the recall tool; it asks its backend, in its prompt's terms
        # (docs/openai-notes.md#prompting).
        return "generate <|SpawnThinking|> to look up anything else"

    @property
    @override
    def model(self) -> str:
        return "gpt-live-1"

    @override
    def realtime_model(
        self, voice: str, options: Mapping[str, OptionValue], backend: str
    ) -> llm.DuplexModel:
        # The response model reads `backend`; GPT-Live reads the agent's instructions. Both
        # are final once the session starts (docs/openai-notes.md).
        return GPTLiveModel(
            voice=voice,
            responses_options=ResponsesDelegationOptions(
                model=str(options[RESPONSE_MODEL]),
                instructions=backend,
                reasoning={"effort": cast(Effort, options[EFFORT])},
            ),
        )

    @override
    def tools(self, options: Mapping[str, OptionValue]) -> Tools:
        return [WebSearch()] if options.get(WEB_SEARCH) else []


OPENAI = OpenAI()
