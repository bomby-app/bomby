"""The voice providers as the app needs them before any call, for Settings and the splash:
each one's id, name, key variable, voices and options (switches and choices). `just agent providers` writes it to
`app/src-tauri/voice-providers.json`, which the core embeds (`voice.rs`), and `just agent
check` fails when that file is out of date, so the definitions here stay the one source.

    python -m voice_providers.catalogue write|check <path>
"""

import json
import sys
from pathlib import Path

from . import PROVIDERS
from .provider import Choice, Option, Switch, VoiceProvider

GENERATED = (
    "Generated from agent/voice_providers/ by `just agent providers`; don't edit."
)


def _option(option: Option) -> dict[str, object]:
    match option:
        case Switch():
            return {"id": option.id, "kind": "switch", "default": option.default}
        case Choice():
            return {
                "id": option.id,
                "kind": "choice",
                "default": option.default,
                "values": list(option.values),
                "follows": option.follows or None,
                "per": {leader: list(values) for leader, values in option.per.items()},
            }


def _entry(provider: VoiceProvider) -> dict[str, object]:
    return {
        "id": provider.id,
        "name": provider.name,
        "key_env": provider.key_env,
        "default_voice": provider.default_voice,
        "voices": [
            {"id": v.id, "name": v.name, "description": v.description}
            for v in provider.voices
        ],
        "options": [_option(option) for option in provider.options],
    }


def render() -> str:
    """The catalogue as JSON, the providers in `PROVIDERS`' order."""
    catalogue = {
        "generated": GENERATED,
        "providers": [_entry(p) for p in PROVIDERS.values()],
    }
    return json.dumps(catalogue, indent=2, ensure_ascii=False) + "\n"


def main(args: list[str]) -> int:
    match args:
        case ["write", path]:
            _ = Path(path).write_text(render(), encoding="utf-8")
            return 0
        case ["check", path]:
            file = Path(path)
            if file.exists() and file.read_text(encoding="utf-8") == render():
                return 0
            print(
                f"{path} is out of date with agent/voice_providers/: run just agent providers",
                file=sys.stderr,
            )
            return 1
        case _:
            print(__doc__, file=sys.stderr)
            return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
