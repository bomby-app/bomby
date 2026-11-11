"""Talks ACP to any harness: the client side of the protocol (`client.py`), the runner
that keeps a call's adapter processes and named sessions (`runner.py`), what a harness is
started with (`environment.py`) and the setup probe (`probe.py`). What differs per agent
lives in `harnesses/`.

Nothing is imported here, so the probe loads without the runner and LiveKit with it."""
