"""The call's tasks, as the app's agents panel shows them: which agent, which session,
what it was asked, and how it's going. Published as one attribute on the agent's own
LiveKit participant (`bomby.tasks`, JSON), which the page reads with `useAgent()`.
LiveKit allows 64 KiB of attributes in all, so only the latest tasks are kept, each
shortened."""

import json
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass
from itertools import count
from typing import Literal, final

from harnesses import Harness

logger = logging.getLogger("bomby.task_board")

ATTRIBUTE = "bomby.tasks"
KEEP = 20
TASK_CHARS = 160

Status = Literal["working", "added", "done", "failed", "stopped"]
"""`added`: sent to a session that was still working, so it joined that task."""


@dataclass
class Task:
    id: str
    agent: str
    agentName: str
    session: str
    task: str
    status: Status
    startedAt: int
    endedAt: int | None = None


def _now_ms() -> int:
    return int(time.time() * 1000)


@final
class TaskBoard:
    """Keeps the call's latest tasks and publishes them whenever one starts or ends."""

    def __init__(self, publish: Callable[[dict[str, str]], Awaitable[None]]) -> None:
        self._publish = publish
        self._tasks: list[Task] = []
        self._ids = count(1)

    @property
    def tasks(self) -> list[Task]:
        return list(self._tasks)

    async def start(self, harness: Harness, session: str, task: str) -> str:
        short = task if len(task) <= TASK_CHARS else task[: TASK_CHARS - 1] + "…"
        entry = Task(
            id=str(next(self._ids)),
            agent=harness.id,
            agentName=harness.short_name,
            session=session,
            task=short,
            status="working",
            startedAt=_now_ms(),
        )
        self._tasks = [*self._tasks, entry][-KEEP:]
        await self._send()
        return entry.id

    async def finish(self, id: str, status: Status) -> None:
        for entry in self._tasks:
            if entry.id == id:
                entry.status, entry.endedAt = status, _now_ms()
        await self._send()

    async def _send(self) -> None:
        payload = json.dumps([asdict(t) for t in self._tasks], ensure_ascii=False)
        try:
            await self._publish({ATTRIBUTE: payload})
        # The panel is a view: a failed update never stops the work.
        except (RuntimeError, ConnectionError, OSError) as e:
            logger.warning("couldn't publish the task list: %s", e)
