"""The job's dispatch metadata: one JSON object the app sends with every call
(`app/src-tauri/src/calls.rs`, `dispatch_metadata`). It's read once, here, and each part
takes the fields it needs: the project (`project.py`), the installed agents
(`harnesses/installed.py`), and the voice and history (`call_options.py`). Console runs have
no metadata, and each part falls back to the environment.
"""

import json
from collections.abc import Mapping
from typing import cast

type JobFields = Mapping[str, object] | None
"""The metadata's fields, or None on a console run."""


def read_metadata(metadata: str) -> JobFields:
    """The fields of the job's metadata, or None when there is none."""
    if not metadata.strip():
        return None
    data = cast(object, json.loads(metadata))
    fields = cast(dict[str, object], data) if isinstance(data, dict) else None
    if fields is None:
        raise ValueError("job metadata must be a JSON object")
    return fields
