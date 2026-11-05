"""The packaged agent's one program, frozen with PyInstaller into one folder
(`just agent freeze`). The app runs it as `bomby-agent start` (the worker, `agent.py`) or
`bomby-agent probe '<json>'` (the setup checks, `probe.py`). From source, those are
`python agent.py start` and `python probe.py '<json>'`.
"""

import multiprocessing
import sys


def main() -> None:
    # LiveKit runs each job in a process it spawns from this same program ("spawn" on
    # macOS). In a frozen program that child must stop here, before any CLI runs.
    multiprocessing.freeze_support()
    if sys.argv[1:2] == ["probe"]:
        import probe

        probe.cli(sys.argv[2:])
    else:
        import agent

        agent.main()


if __name__ == "__main__":
    main()
