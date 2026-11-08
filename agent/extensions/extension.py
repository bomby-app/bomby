"""What one extension is: a self-contained tool set the voice model gets on a call, with a
note for its prompt, that keeps its data in the app (docs/decisions/extensions.md).

An extension never touches LiveKit or the app's database itself. It reaches the app through
an `AppBridge` (`bridge.py`, RPC to the app's page, which asks the core), and the app sends
what it needs at the start of a call in the job's metadata (`extensions` in `job.py`).
"""

from abc import ABC, abstractmethod
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import ClassVar, Protocol

from pydantic import JsonValue

from sections import MARKDOWN, Style
from voice_providers import Tools

from .tokens import Tokens


class ExtensionError(Exception):
    """Something the voice model should hear as is: the app refused a change ("There's no
    to-do number 9.") or couldn't be reached. Tools raise it on as a `ToolError`."""


class AppBridge(Protocol):
    """The app, as an extension's tools reach it during a call."""

    async def call(self, method: str, payload: Mapping[str, JsonValue]) -> JsonValue:
        """Asks the app to run `method` ("todos.add") with `payload`, and returns its
        answer. Raises `ExtensionError` with a line for the voice model when it refuses or
        can't be reached."""
        ...


@dataclass(frozen=True)
class ExtensionContext:
    """What an extension gets for one call."""

    bridge: AppBridge
    style: Style = MARKDOWN
    """How everything that reaches the voice model is written (`sections.py`)."""
    data: Mapping[str, JsonValue] = field(default_factory=dict[str, JsonValue])
    """What the app sent for this extension when the call started."""
    tokens: Tokens | None = None
    """The core's access tokens for the hosted MCP extensions (`tokens.py`); None outside
    the app."""


class Extension(ABC):
    """A tool set the user turns on in Settings, Extensions, and per project."""

    id: ClassVar[str]
    """Its id in the job's metadata, the app's settings and RPC method names ("todos").
    Short, lowercase, stable."""
    name: ClassVar[str]
    """How Settings names it: "To-dos"."""
    description: ClassVar[str]
    """One line for Settings: what it gives the user."""
    default_on: ClassVar[bool] = True
    """Whether it's on until the user says otherwise."""

    def note(self, context: ExtensionContext) -> str:
        """Its section of the instructions of whichever model calls the tools, written in
        `context.style`; empty for none."""
        del context
        return ""

    @abstractmethod
    def tools(self, context: ExtensionContext) -> Tools:
        """Its tools for one call, bound to `context`."""
