"""Checks whether the agents the app found are set up, for Settings. The app runs it with
the same metadata it gives a call, and reads one JSON object back, by agent id:

    python probe.py '{"agents": {"goose": "/abs/path/goose"}}'
    {"goose": {"ready": false, "problem": "...", "fix": "goose configure", ...}}

The metadata may also hold each agent's picks, applied before judging (`"picks":
{"goose": [{"setting": "provider", "value": "openrouter"}]}`), and the agents whose
settings the model picker lists (`"listing": ["omp"]`).
"""

import asyncio
import dataclasses
import json
import logging
import os
import sys

import dev_env
from acp_client.probe import probe_all
from acp_client.settings import saved_picks
from harnesses import HARNESSES, installed
from job import JobFields, read_metadata


def main(metadata: str) -> str:
    fields = read_metadata(metadata)
    agents = {
        id: (HARNESSES[id], program)
        for id, program in installed(fields, HARNESSES, os.environ).items()
    }
    setups = asyncio.run(
        probe_all(agents, os.environ, saved_picks(fields), listing(fields))
    )
    return json.dumps({id: dataclasses.asdict(s) for id, s in setups.items()})


def listing(fields: JobFields) -> frozenset[str]:
    """The agents whose settings the model picker lists."""
    return fields.listing if fields else frozenset()


def cli(args: list[str]) -> None:
    """Prints the setups for the metadata in `args[0]` (no agents without one)."""
    dev_env.load()
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
    print(main(args[0] if args else '{"agents": {}}'))


if __name__ == "__main__":
    cli(sys.argv[1:])
