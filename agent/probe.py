"""Checks whether the agents the app found are set up, for Settings. The app runs it with
the same metadata it gives a call, and reads one JSON object back, by agent id:

    python probe.py '{"agents": {"goose": "/abs/path/goose"}}'
    {"goose": {"ready": false, "problem": "...", "fix": "goose configure", ...}}

The metadata may also hold each agent's saved choices, applied before judging (`"choices":
{"goose": [{"setting": "provider", "value": "openrouter"}]}`), and the agents the user is
setting up (`"setting_up": ["omp"]`), which get a session even when they can't delete it.
"""

import asyncio
import dataclasses
import json
import logging
import os
import sys
from typing import cast

import dev_env
from acp_client.probe import probe_all
from acp_client.settings import saved_choices
from harnesses import HARNESSES, installed
from job import JobFields, read_metadata


def main(metadata: str) -> str:
    fields = read_metadata(metadata)
    agents = {
        id: (HARNESSES[id], program)
        for id, program in installed(fields, HARNESSES, os.environ).items()
    }
    setups = asyncio.run(
        probe_all(agents, os.environ, saved_choices(fields), setting_up(fields))
    )
    return json.dumps({id: dataclasses.asdict(s) for id, s in setups.items()})


def setting_up(fields: JobFields) -> frozenset[str]:
    """The agents the user is setting up, which get a session even if they can't delete it."""
    raw: object = (fields or {}).get("setting_up", [])
    ids = cast(list[object], raw) if isinstance(raw, list) else None
    if ids is None or not all(isinstance(id, str) for id in ids):
        raise ValueError("setting_up must be a list of agent ids")
    return frozenset(cast(list[str], ids))


def cli(args: list[str]) -> None:
    """Prints the setups for the metadata in `args[0]` (no agents without one)."""
    dev_env.load()
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
    print(main(args[0] if args else '{"agents": {}}'))


if __name__ == "__main__":
    cli(sys.argv[1:])
