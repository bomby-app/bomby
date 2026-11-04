"""Exit when the desktop app does.

The app starts the worker with `BOMBY_EXIT_WITH_APP=1` and keeps a pipe to its stdin.
When the app's process ends for any reason (quit, crash, Ctrl-C on `just app dev`), the OS
closes that pipe; reading it hits end of file, and the worker stops its whole process group
(uv, this process, the job processes). Without it, a worker outlived the app (2026-11-04).
"""

import os
import signal
import sys
import threading
import time

ENV = "BOMBY_EXIT_WITH_APP"
# livekit-agents drains on SIGTERM and can wait for jobs; the app is gone, so don't.
GRACE_S = 3


def _watch() -> None:
    try:
        while sys.stdin.buffer.read(4096):
            pass
    except (OSError, ValueError):
        pass
    group = os.getpgrp()
    os.killpg(group, signal.SIGTERM)
    time.sleep(GRACE_S)
    os.killpg(group, signal.SIGKILL)


def exit_with_app() -> None:
    """Starts the watch if the app launched this process; a no-op otherwise (console)."""
    if os.environ.get(ENV) == "1":
        threading.Thread(target=_watch, name="lifeline", daemon=True).start()
