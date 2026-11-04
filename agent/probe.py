"""Checks whether the agents the app found are set up, for Settings. The app runs it with
the same metadata it gives a call, and reads one JSON object back, by agent id:

    python probe.py '{"agents": {"goose": "/abs/path/goose"}}'
    {"goose": {"ready": false, "problem": "...", "fix": "goose configure", ...}}
"""

import asyncio
import dataclasses
import json
import logging
import os
import sys

from dotenv import load_dotenv

from acp_client.probe import probe_all
from harnesses import HARNESSES, installed
from job import read_metadata


def main(metadata: str) -> str:
    agents = {
        id: (HARNESSES[id], program)
        for id, program in installed(
            read_metadata(metadata), HARNESSES, os.environ
        ).items()
    }
    setups = asyncio.run(probe_all(agents, os.environ))
    return json.dumps({id: dataclasses.asdict(s) for id, s in setups.items()})


if __name__ == "__main__":
    _ = load_dotenv()
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
    print(main(sys.argv[1] if len(sys.argv) > 1 else '{"agents": {}}'))
