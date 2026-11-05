"""Checks a frozen agent (`just agent freeze`) runs: the probe answers, and the worker starts
a job process and stops with its whole group when the app's pipe closes. It never reaches
LiveKit: the worker is pointed at a local port where nothing listens.

    python check_frozen.py dist/bomby-agent/bomby-agent

CI runs it on the signed agent inside the app (.github/workflows/release.yml), where it
also shows that hardened runtime loads every library.
"""

import os
import subprocess
import sys
import time

READY_LINE = "process initialized"
READY_TIMEOUT_S = 90
EXIT_TIMEOUT_S = 10


def check_probe(program: str) -> None:
    out = subprocess.run(
        [program, "probe", '{"agents": {}}'],
        capture_output=True,
        text=True,
        timeout=READY_TIMEOUT_S,
        check=True,
    ).stdout.strip()
    if out != "{}":
        raise SystemExit(f"The probe answered {out!r}, not {{}}")
    print("probe: answers")


def group_size(pgid: int) -> int:
    # pgrep exits 1 when it finds none, which is the answer, not a failure.
    found = subprocess.run(
        ["pgrep", "-g", str(pgid)], capture_output=True, text=True, check=False
    )
    return len(found.stdout.split())


def check_worker(program: str) -> None:
    env = os.environ | {
        "LIVEKIT_URL": "ws://127.0.0.1:9",
        "LIVEKIT_API_KEY": "check",
        "LIVEKIT_API_SECRET": "check",
        "GOOGLE_API_KEY": "check",
        "BOMBY_EXIT_WITH_APP": "1",
    }
    worker = subprocess.Popen(
        [program, "start"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=env,
        text=True,
        process_group=0,
    )
    assert worker.stdin and worker.stdout
    deadline = time.monotonic() + READY_TIMEOUT_S
    lines: list[str] = []
    for line in worker.stdout:
        lines.append(line)
        if READY_LINE in line:
            break
        if time.monotonic() > deadline:
            break
    if not any(READY_LINE in line for line in lines):
        os.killpg(worker.pid, 9)
        raise SystemExit("The worker started no job process:\n" + "".join(lines[-30:]))
    print("worker: starts a job process")

    worker.stdin.close()  # what the app quitting looks like to the worker
    deadline = time.monotonic() + EXIT_TIMEOUT_S
    while group_size(worker.pid) and time.monotonic() < deadline:
        time.sleep(0.5)
    if left := group_size(worker.pid):
        os.killpg(worker.pid, 9)
        raise SystemExit(f"{left} of the worker's processes outlived the app")
    print("worker: stops with the app")


if __name__ == "__main__":
    check_probe(sys.argv[1])
    check_worker(sys.argv[1])
