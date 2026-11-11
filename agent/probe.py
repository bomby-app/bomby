"""Checks whether the agents the app found are set up, for Settings. The app runs it with
the same metadata it gives a call, and reads one JSON object back, by agent id:

    python probe.py '{"agents": {"goose": "/abs/path/goose"}}'
    {"goose": {"step": "sign_in", "problem": "...", "fix": "goose configure", ...}}

The metadata may also hold each agent's picks, applied before judging (`"picks":
{"goose": [{"setting": "provider", "value": "openrouter"}]}`), and the agents whose
settings the model picker lists (`"listing": ["omp"]`), and those to open a session in even
though they can't delete it (`"sessions": ["omp"]`).
"""

import asyncio
import dataclasses
import json
import logging
import os
import sys

import dev_env
from acp_client.probe import probe_all
from harnesses import HARNESSES, installed
from job import read_metadata


def main(metadata: str) -> str:
    """The answer for `metadata`; `{}` (no agent checked) when it can't be read, with why on
    stderr, so the app shows every agent unchecked instead of failing the whole look."""
    try:
        fields = read_metadata(metadata)
        agents = {
            id: (HARNESSES[id], program)
            for id, program in installed(fields, HARNESSES, os.environ).items()
        }
    except ValueError as e:  # pydantic's ValidationError is one
        print(f"probe: unreadable metadata: {e}", file=sys.stderr)
        return "{}"
    picks = fields.picks if fields else {}
    listing = fields.listing if fields else ()
    sessions = fields.sessions if fields else ()
    setups = asyncio.run(probe_all(agents, os.environ, picks, listing, sessions))
    return json.dumps({id: dataclasses.asdict(s) for id, s in setups.items()})


def cli(args: list[str]) -> None:
    """Prints the setups for the metadata in `args[0]` (no agents without one)."""
    dev_env.load()
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
    print(main(args[0] if args else '{"agents": {}}'))


if __name__ == "__main__":
    cli(sys.argv[1:])
