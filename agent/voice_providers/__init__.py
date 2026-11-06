"""The voice models Bomby talks through, one definition per file (`gemini.py`,
`openai.py`, `rime.py`), all of the `VoiceProvider` type (`provider.py`). The app picks one for each
call, with its voice and options (`provider`, `voice` and `provider_options` in the job's
metadata); console runs use `VOICE_PROVIDER`
([decision](../../docs/decisions/voice-providers-like-harnesses.md)).

To add one: write its definition next to these, with the `prompt_style` it reads best
(`sections.py`), list it in `PROVIDERS`, write its tone prompts in `prompts/<id>/` (and
`backend.md` for one that `delegates`), keep
its key from the coding agents (`APP_KEYS` in `acp_client/runner.py`), check its plugin
sends the user's transcripts as `memory.py` expects (docs/livekit-notes.md), and run
`just agent providers` so the app gets its name, key, voices and options
(`app/src-tauri/voice-providers.json`, `catalogue.py`). The app then needs a
`VoiceProvider` variant with its keychain field (`app/src-tauri/src/voice.rs`,
`credentials.rs`), its copy, logo and key page (`app/src/features/voice/`), and the key page
in both windows' opener allow lists (`app/src-tauri/capabilities/`).
"""

from .gemini import GEMINI
from .openai import OPENAI
from .provider import Choice, Option, OptionValue, Switch, Tools, VoiceProvider
from .rime import RIME

# In the order the app shows them (owner, 2026-11-07).
PROVIDERS: dict[str, VoiceProvider] = {p.id: p for p in (GEMINI, OPENAI, RIME)}

# A call that names no provider: every call before there was a choice.
DEFAULT_PROVIDER = GEMINI.id


def provider(name: str) -> VoiceProvider:
    """The provider called `name`, or the default for an empty one. Raises ValueError for
    one Bomby doesn't have, which fails the call at start like any invalid metadata."""
    found = PROVIDERS.get(name or DEFAULT_PROVIDER)
    if found is None:
        raise ValueError(
            f"Unknown voice provider {name!r}; Bomby has {', '.join(sorted(PROVIDERS))}."
        )
    return found


__all__ = [
    "DEFAULT_PROVIDER",
    "GEMINI",
    "OPENAI",
    "PROVIDERS",
    "RIME",
    "Choice",
    "Option",
    "OptionValue",
    "Switch",
    "Tools",
    "VoiceProvider",
    "provider",
]
