"""Extensions: self-contained tool sets the user turns on in Settings, Extensions, and per
project, one definition per file (`todos.py`, `call_names.py`), all of the `Extension` type (`extension.py`)
([decision](../../docs/decisions/extensions.md)).

The app sends the ones a call has, each with what it needs at the start (`extensions` in the
job's metadata); each adds its tools for the model that calls them and a note to its
instructions, and reaches the app over RPC (`bridge.py`). Console runs have none: there's no
app to keep their data.

A hosted MCP extension (`hosted_mcp.py`: `zapier.py`, `composio.py`) is a vendor's MCP
server instead, signed in to by the app, which hands the call its tokens (`tokens.py`).

To add one: write its definition next to these, list it in `EXTENSIONS`, and run
`just agent extensions` so Settings lists it (`app/src-tauri/extensions.json`,
`catalogue.py`). The app then needs its data and commands in the core
(`app/src-tauri/src/extensions/`), its RPC handlers and UI in a feature of its own, and an
entry in the page's list of extensions (`app/src/features/extensions/`).
"""

from collections.abc import Mapping
from dataclasses import replace

from pydantic import JsonValue

from sections import Style
from voice_providers import Tools

from .call_names import CALL_NAMES_EXTENSION
from .composio import COMPOSIO_EXTENSION
from .extension import AppBridge, Extension, ExtensionContext, ExtensionError
from .todos import TODOS_EXTENSION
from .tokens import Tokens
from .zapier import ZAPIER_EXTENSION

# In the order Settings lists them.
EXTENSIONS: dict[str, Extension] = {
    e.id: e
    for e in (
        TODOS_EXTENSION,
        CALL_NAMES_EXTENSION,
        ZAPIER_EXTENSION,
        COMPOSIO_EXTENSION,
    )
}


class CallExtensions:
    """The extensions one call has, each with its context."""

    def __init__(
        self, on: list[tuple[Extension, ExtensionContext]] | None = None
    ) -> None:
        self.on: list[tuple[Extension, ExtensionContext]] = on or []

    @classmethod
    def for_call(
        cls,
        sent: Mapping[str, Mapping[str, JsonValue]],
        bridge: AppBridge,
        style: Style,
        tokens: Tokens | None = None,
    ) -> "CallExtensions":
        """The extensions the app sent that Bomby has, in `EXTENSIONS`' order; one it
        doesn't have (from a newer app) is left out."""
        return cls(
            [
                (
                    e,
                    ExtensionContext(
                        bridge=bridge, style=style, data=sent[e.id], tokens=tokens
                    ),
                )
                for e in EXTENSIONS.values()
                if e.id in sent
            ]
        )

    def tools(self) -> Tools:
        return [tool for e, context in self.on for tool in e.tools(context)]

    def notes(self, style: Style) -> list[str]:
        """Each extension's note, in `style`: the voice model's, or the backend's."""
        return [e.note(replace(context, style=style)) for e, context in self.on]

    @property
    def ids(self) -> list[str]:
        return [e.id for e, _ in self.on]


__all__ = [
    "EXTENSIONS",
    "AppBridge",
    "CallExtensions",
    "Extension",
    "ExtensionContext",
    "ExtensionError",
]
