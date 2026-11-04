"""Which agents are installed for this call: the app finds them and sends their programs
in the job metadata (`"agents": {"claude": "/abs/path/claude", ...}`). Console runs have
no metadata, so each known agent's program is looked up on PATH instead."""

import logging
import shutil
from collections.abc import Mapping
from pathlib import Path
from typing import cast

from job import JobFields

from .harness import Harness

logger = logging.getLogger("bomby.harnesses")


def installed(
    fields: JobFields, known: Mapping[str, Harness], environ: Mapping[str, str]
) -> dict[str, Path]:
    """The known agents that are installed, by id, with their programs, from the job's
    metadata (`job.py`)."""
    if fields is None:
        path = environ.get("PATH")
        found = {id: shutil.which(h.program, path=path) for id, h in known.items()}
        return {id: Path(p) for id, p in found.items() if p}

    raw: object = fields.get("agents") or {}
    items = cast(dict[str, object], raw) if isinstance(raw, dict) else None
    if items is None:
        raise ValueError("agents must be an object of program paths")
    agents: dict[str, Path] = {}
    for id, value in items.items():
        if id not in known:
            logger.warning("ignoring unknown agent %r", id)
            continue
        if not isinstance(value, str) or not Path(value).is_absolute():
            raise ValueError(f"agent {id} needs an absolute program path")
        agents[id] = Path(value)
    return agents
