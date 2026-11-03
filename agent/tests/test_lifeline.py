import os
import subprocess
import sys
import textwrap
from pathlib import Path

AGENT_DIR = Path(__file__).resolve().parent.parent

# A stand-in worker: starts the lifeline, then would run forever.
SCRIPT = textwrap.dedent(
    """
    import time
    import lifeline
    lifeline.exit_with_app()
    print("ready", flush=True)
    time.sleep(60)
    """
)


def _start(env_value: str | None) -> subprocess.Popen[str]:
    env = {k: v for k, v in os.environ.items() if k != "CLAUDIBLE_EXIT_WITH_APP"}
    if env_value is not None:
        env["CLAUDIBLE_EXIT_WITH_APP"] = env_value
    proc = subprocess.Popen(
        [sys.executable, "-c", SCRIPT],
        cwd=AGENT_DIR,
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        process_group=0,  # its own group, as the app starts it; killpg stays inside it
    )
    assert proc.stdout is not None
    assert proc.stdout.readline().strip() == "ready"
    return proc


def test_exits_when_the_app_closes_its_stdin() -> None:
    proc = _start("1")
    assert proc.stdin is not None
    proc.stdin.close()
    assert proc.wait(timeout=10) != 0  # stopped by the signal


def test_does_nothing_without_the_app() -> None:
    proc = _start(None)
    assert proc.stdin is not None
    proc.stdin.close()
    try:
        _ = proc.wait(timeout=1)
        raise AssertionError("the process exited without the app asking it to")
    except subprocess.TimeoutExpired:
        pass
    finally:
        proc.kill()
        _ = proc.wait()
