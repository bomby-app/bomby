"""The extensions as Settings needs them before any call: each one's id, name, description
and whether it's on by default. `just agent extensions` writes it to
`app/src-tauri/extensions.json`, which the core embeds (`extensions/mod.rs`), and `just agent
check` fails when that file is out of date, so the definitions here stay the one source.

    python -m extensions.catalogue write|check <path>
"""

import json
import sys
from pathlib import Path

from . import EXTENSIONS

GENERATED = "Generated from agent/extensions/ by `just agent extensions`; don't edit."


def render() -> str:
    """The catalogue as JSON, the extensions in `EXTENSIONS`' order."""
    catalogue = {
        "generated": GENERATED,
        "extensions": [
            {
                "id": e.id,
                "name": e.name,
                "description": e.description,
                "default_on": e.default_on,
            }
            for e in EXTENSIONS.values()
        ],
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
                f"{path} is out of date with agent/extensions/: run just agent extensions",
                file=sys.stderr,
            )
            return 1
        case _:
            print(__doc__, file=sys.stderr)
            return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
