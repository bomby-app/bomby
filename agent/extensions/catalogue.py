"""The extensions as Settings needs them before any call: each one's id, name, description,
whether it's on by default, and for a hosted MCP extension how the core connects it
(`connect`: its MCP URL, the vendor's page and the hosts its links may go to; null for the
others). `just agent extensions` writes it to
`app/src-tauri/extensions.json`, which the core embeds (`extensions/mod.rs`), and `just agent
check` fails when that file is out of date, so the definitions here stay the one source.

    python -m extensions.catalogue write|check <path>
"""

import json
import sys
from pathlib import Path

from pydantic import JsonValue

from . import EXTENSIONS
from .extension import Extension
from .hosted_mcp import HostedMcp

GENERATED = "Generated from agent/extensions/ by `just agent extensions`; don't edit."


def connect(e: Extension) -> JsonValue:
    if not isinstance(e, HostedMcp):
        return None
    return {
        "mcp_url": e.connect.mcp_url,
        "manage_url": e.connect.manage_url,
        "link_hosts": list(e.connect.link_hosts),
    }


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
                "connect": connect(e),
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
