"""A call the voice model's service ends: what the app is told.

When the voice model fails for good (no credits left, a key that stopped working), LiveKit
closes the session but leaves the agent in the room, so the page would go on showing a call
nobody answers. The agent says why in one attribute on its own participant
(`bomby.failure`); the page shows the line and ends the call (docs/architecture.md).
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from typing import cast, final, override

from livekit.agents import CloseEvent, CloseReason

logger = logging.getLogger("bomby.call_failure")

ATTRIBUTE = "bomby.failure"
# The most the page is sent: a line for an error card, not a log.
LINE_CHARS = 300
# The logger LiveKit's own engines log to, and where a service's error is on a record.
LIVEKIT_LOGGER = "livekit.agents"
SERVICE_ERROR = "lk.pii.error"
# How long before the session closes a service's error still counts as the reason: LiveKit
# tries again a few times first (about 2 s for GPT-Live).
RECENT_S = 30.0

_telling: set[asyncio.Task[None]] = set()


@final
class ServiceErrors(logging.Filter):
    """Remembers what the voice model's service last said went wrong.

    LiveKit's GPT-Live engine logs the service's error (its type, code and message, under
    `lk.pii.error`) and raises one without them (`llm/_realtime/gpt_live.py`,
    `_handle_error`, livekit-agents 1.8.11), so its log record is the only place the
    service's own words are. Every record passes."""

    def __init__(self) -> None:
        super().__init__()
        self._last: tuple[str, float] | None = None

    @classmethod
    def listen(cls) -> "ServiceErrors":
        """One that hears LiveKit's engines from now on."""
        errors = cls()
        logging.getLogger(LIVEKIT_LOGGER).addFilter(errors)
        return errors

    @override
    def filter(self, record: logging.LogRecord) -> bool:
        body: object = getattr(record, SERVICE_ERROR, None)
        if isinstance(body, dict):
            message = cast(dict[str, object], body).get("message")
            if isinstance(message, str) and message.strip():
                self._last = (message.strip(), record.created)
        return True

    def said(self, now: float | None = None) -> str | None:
        """The service's last message, if it's from the last `RECENT_S`."""
        if self._last is None:
            return None
        message, at = self._last
        return message if (now or time.time()) - at <= RECENT_S else None


def failure_line(service: str, said: str | None) -> str:
    """What the user reads: who ended the call, and why in the service's own words when it
    gave any. The page shows the first sentence as the card's headline."""
    line = (
        f"{service} ended the call: {said}"
        if said
        else f"{service} ended the call. Check your key and your account with {service}, "
        + "then try again."
    )
    return line if len(line) <= LINE_CHARS else line[: LINE_CHARS - 1] + "…"


def report(
    event: CloseEvent,
    service: str,
    errors: ServiceErrors,
    publish: Callable[[dict[str, str]], Awaitable[None]],
    now: float | None = None,
) -> None:
    """Tells the app why, when the session closed on an error. Any other close (the user
    ended the call, the job is shutting down) says nothing. Never waits: the session is
    closing."""
    if event.reason is not CloseReason.ERROR:
        return
    line = failure_line(service, errors.said(now))
    logger.error("the voice model ended the call: %s", line)

    async def tell() -> None:
        try:
            await publish({ATTRIBUTE: line})
        except Exception:
            logger.exception("couldn't tell the app the call ended")

    task = asyncio.create_task(tell())
    _telling.add(task)
    task.add_done_callback(_telling.discard)
