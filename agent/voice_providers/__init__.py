"""The voice models Bomby talks through, one definition per file (`gemini.py`,
`rime.py`), all of the `VoiceProvider` type (`provider.py`). The app picks one for each
call, with its voice and options (`provider`, `voice` and `provider_options` in the job's
metadata); console runs use `VOICE_PROVIDER`
([decision](../../docs/decisions/voice-providers-like-harnesses.md)).

To add one: write its definition next to these, list it in `PROVIDERS`, write its tone
prompts in `prompts/<id>/` for how it reads them, keep its key from the coding agents
(`APP_KEYS` in `acp_client/runner.py`), and give the app its key, voices and options
(`app/src-tauri/src/settings.rs`).
"""

from .gemini import GEMINI
from .provider import Tools, VoiceProvider
from .rime import RIME

PROVIDERS: dict[str, VoiceProvider] = {p.id: p for p in (GEMINI, RIME)}

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
    "PROVIDERS",
    "RIME",
    "Tools",
    "VoiceProvider",
    "provider",
]
