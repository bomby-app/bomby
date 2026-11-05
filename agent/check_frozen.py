"""Checks a frozen agent (`just agent freeze`) runs: the probe answers, and the worker starts
a job process and stops with its whole group when the app's pipe closes. It never reaches
LiveKit: the worker is pointed at a local port where nothing listens.

    python check_frozen.py dist/bomby-agent/bomby-agent

CI runs it on the signed agent inside the app (.github/workflows/release.yml), where it
also shows that hardened runtime loads every library.
"""

import os
import queue
import signal
import subprocess
import sys
import threading
import time
from typing import IO

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
    try:
        assert worker.stdin and worker.stdout
        wait_for_job_process(worker.stdout)
        print("worker: starts a job process")

        worker.stdin.close()  # what the app quitting looks like to the worker
        deadline = time.monotonic() + EXIT_TIMEOUT_S
        while group_size(worker.pid) and time.monotonic() < deadline:
            time.sleep(0.5)
        if left := group_size(worker.pid):
            raise SystemExit(f"{left} of the worker's processes outlived the app")
        print("worker: stops with the app")
    finally:
        # Whatever happened, nothing of the worker is left running.
        if group_size(worker.pid):
            os.killpg(worker.pid, signal.SIGKILL)
        _ = worker.wait(timeout=EXIT_TIMEOUT_S)


def wait_for_job_process(stdout: IO[str]) -> None:
    """Waits, up to READY_TIMEOUT_S even when the worker goes quiet, for its job process."""
    lines: queue.Queue[str | None] = queue.Queue()

    def read() -> None:
        for line in stdout:
            lines.put(line)
        lines.put(None)  # the worker closed its output

    threading.Thread(target=read, daemon=True).start()
    seen: list[str] = []
    deadline = time.monotonic() + READY_TIMEOUT_S
    while (left := deadline - time.monotonic()) > 0:
        try:
            line = lines.get(timeout=left)
        except queue.Empty:
            break
        if line is None:
            break
        seen.append(line)
        if READY_LINE in line:
            return
    raise SystemExit("The worker started no job process:\n" + "".join(seen[-30:]))


if __name__ == "__main__":
    check_probe(sys.argv[1])
    check_worker(sys.argv[1])
