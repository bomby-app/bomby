"""What one call works on: a project's name, its folders and what the user wrote about
it, from the job's dispatch metadata."""

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from job import JobFields

DEFAULT_PROJECT = "home"


@dataclass(frozen=True)
class Project:
    """A project name, the folders an agent works in, and the user's description.

    The first folder is the working directory and the rest are added as extra directories.
    They tell the agent where the project lives; they don't fence it in, since sessions
    bypass permissions. `instructions` is what the user wrote about the project, empty
    when they wrote nothing; the voice model and every coding agent are told it once.
    """

    name: str
    folders: tuple[Path, ...]
    instructions: str = ""
    # The user turned the project's agents off, so its calls hand nothing off.
    agents_off: bool = False

    @property
    def cwd(self) -> Path:
        return self.folders[0]

    @property
    def extra_folders(self) -> list[str]:
        return [str(folder) for folder in self.folders[1:]]

    @classmethod
    def from_job(cls, fields: JobFields, environ: Mapping[str, str]) -> "Project":
        """The project from the job's metadata (`job.py`), else from the environment.

        The metadata has `{"project": "samba", "folders": ["/abs/path", ...],
        "instructions": "..."}`. Console runs have no metadata, so `BOMBY_PROJECT`,
        `BOMBY_FOLDERS` (separated by `os.pathsep`) and `BOMBY_INSTRUCTIONS` stand in.
        Without folders, the project is the home folder.
        """
        agents_off = False
        if fields is not None:
            name, folders = fields.project, fields.folders
            instructions = fields.instructions
            agents_off = fields.agents_off
        else:
            name = environ.get("BOMBY_PROJECT", "").strip()
            folders = tuple(
                Path(f) for f in environ.get("BOMBY_FOLDERS", "").split(os.pathsep) if f
            )
            instructions = environ.get("BOMBY_INSTRUCTIONS", "").strip()

        paths = folders or (Path.home(),)
        for path in paths:
            if not path.is_absolute():
                raise ValueError(f"project folder must be an absolute path: {path}")
            if not path.is_dir():
                raise ValueError(f"project folder does not exist: {path}")
        return cls(
            name=name or DEFAULT_PROJECT,
            folders=paths,
            instructions=instructions,
            agents_off=agents_off,
        )
