"""Talks ACP to any harness: the client side of the protocol (`client.py`) and the runner
that keeps a call's adapter processes and named sessions (`runner.py`). What differs per
agent lives in `harnesses/`."""

from .runner import AcpRunner, CallRunners, session_name

__all__ = ["AcpRunner", "CallRunners", "session_name"]
