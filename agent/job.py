"""The job's dispatch metadata: one JSON object the app sends with every call
(`app/src-tauri/src/calls.rs`, `dispatch_metadata`) and with every probe (`setup.rs`).
`JobMetadata` is its contract: it's read and checked once, here, and each part takes the
fields it needs: the project (`project.py`), the installed agents
(`harnesses/installed.py`), each agent's picks (`acp_client/settings.py`), who the probe
lists (`probe.py`), and the voice and history (`call_options.py`). Console runs have no
metadata, and each part falls back to the environment.

`Pick` and `Line` are pydantic dataclasses rather than models: they're checked inside
`JobMetadata` like any field, and the rest of the agent builds them by position too. The
stdlib dataclasses in `acp_client/settings.py` (`Setting`, `Skipped`, `Applied`) are built
from ACP's own types, never read from JSON.
"""

from pathlib import Path
from typing import Annotated, ClassVar, Literal, cast

from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator
from pydantic.dataclasses import dataclass

Speaker = Literal["user", "agent"]

Text = Annotated[str, StringConstraints(strip_whitespace=True)]


@dataclass(frozen=True)
class Pick:
    """A value the user picked for one of an agent's settings (`acp_client/settings.py`)."""

    setting: str
    value: str


@dataclass(frozen=True)
class Line:
    """One line of the call the user resumed."""

    role: Speaker
    text: Text


class JobMetadata(BaseModel):
    """The fields the app sends. A field left out, or sent as null, takes its default;
    fields Bomby doesn't know are ignored. Each part checks what only it can, like
    whether a folder exists."""

    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True, title="job metadata")

    project: Text = ""
    folders: tuple[Path, ...] = ()
    instructions: Text = ""
    # Each installed agent's program, by agent id.
    agents: dict[str, Path] = {}
    # Each agent's picks, in the order they're applied.
    picks: dict[str, tuple[Pick, ...]] = {}
    # The agents whose settings the probe lists for the model picker.
    listing: frozenset[str] = frozenset()
    # The agents the probe opens a session in even if they can't delete it (once per launch).
    sessions: frozenset[str] = frozenset()
    voice: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)] | None
    ) = None
    user_name: Text = ""
    tone: Text = ""
    # The install's Zep user when calls remember across conversations; empty otherwise.
    memory_user: Text = ""
    # Read memory, save nothing from this call.
    memory_incognito: bool = False
    history: tuple[Line, ...] = ()

    @model_validator(mode="before")
    @classmethod
    def _null_is_absent(cls, data: object) -> object:
        if not isinstance(data, dict):
            return data
        fields = cast(dict[str, object], data)
        return {name: value for name, value in fields.items() if value is not None}


type JobFields = JobMetadata | None
"""The metadata's fields, or None on a console run."""


def read_metadata(metadata: str) -> JobFields:
    """The fields of the job's metadata, or None when there is none. Raises ValueError
    (pydantic's ValidationError) naming each field that doesn't fit."""
    if not metadata.strip():
        return None
    return JobMetadata.model_validate_json(metadata)
